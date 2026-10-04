// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The database client for the API and the worker (ADR 0003). It connects
// only as an app role, which owns nothing and cannot bypass row-level
// security. The migrator role is for the migrate job alone, and app_queue is
// pg-boss's own connection (ADR 0009), so neither can be chosen here.
//
// It passes the host, port, database, user, password, TLS mode, TLS
// negotiation and startup options to pg itself, so PGHOST, PGPORT,
// PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE, PGSSLNEGOTIATION and PGOPTIONS
// cannot change them. pg still reads a few other PG* variables for settings
// left unset here, such as PGBINARY.

import { Kysely, PostgresDialect, type PostgresPool, type PostgresPoolClient } from 'kysely';
import pg from 'pg';

import { isLoopbackHost } from '../scripts/settings.ts';

/** The roles this client may connect as. */
export const CLIENT_ROLES = ['app_api', 'app_worker', 'app_auth'] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

export interface DatabaseTls {
  /**
   * `verify-full` encrypts the connection and checks the server's
   * certificate and host name. `disable` sends everything in clear: it is
   * the default only for a server on this machine, and elsewhere belongs
   * only on a private network such as Compose's.
   */
  readonly mode: 'verify-full' | 'disable';
  /** Certificates to trust for `verify-full`, in PEM. Node.js's own list when left out. */
  readonly ca?: string;
}

/** Reports a problem that no caller is waiting for. */
export type DatabaseLog = (message: string, error: Error) => void;

export interface DatabaseSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly role: ClientRole;
  readonly password: string;
  /** Shown in pg_stat_activity, such as `tps-api`. */
  readonly applicationName: string;
  /** Required unless the server is on this machine. */
  readonly tls?: DatabaseTls;
  /** The most connections the pool opens at once. Defaults to 10. */
  readonly maxConnections?: number;
  /** How long to wait for a connection, from the pool or the server. Defaults to 10 seconds. */
  readonly connectionTimeoutMillis?: number;
  /** The server cancels any statement that runs longer. Defaults to 30 seconds. */
  readonly statementTimeoutMillis?: number;
  /** The server ends a session left idle inside a transaction this long. Defaults to 60 seconds. */
  readonly idleInTransactionTimeoutMillis?: number;
  /**
   * The client stops waiting for a query after this long, in case the server
   * never answers. Defaults to 35 seconds, after the statement timeout.
   */
  readonly queryTimeoutMillis?: number;
  /**
   * How long a connection sits idle before TCP keepalive probes check the
   * server is still there, so a half-open connection fails and leaves the
   * pool. Defaults to 10 seconds.
   */
  readonly keepAliveInitialDelayMillis?: number;
  /** Where problems that no caller is waiting for are reported. Defaults to console.error. */
  readonly log?: DatabaseLog;
  /**
   * Called when a pooled connection fails while no query is running on it,
   * for example when the server restarts. Defaults to reporting it through
   * `log`. The process carries on either way.
   */
  readonly onIdleError?: (error: Error) => void;
}

const defaultLog: DatabaseLog = (message, error) => {
  console.error(message, error.message);
};

/** What withTenant() needs from a client that createDatabase() made. */
interface DatabaseInternals {
  readonly pool: pg.Pool;
  readonly log: DatabaseLog;
}

const internals = new WeakMap<object, DatabaseInternals>();

/**
 * Create a pooled client. Tenant data is reached only through withTenant(),
 * which sets the tenant for one transaction. Call `destroy()` on the result
 * to close the pool.
 */
export function createDatabase<DB>(settings: DatabaseSettings): Kysely<DB> {
  const pool = new pg.Pool(poolConfig(settings));
  const log = neverThrows(settings.log ?? defaultLog);
  const onIdleError =
    settings.onIdleError ??
    ((error: Error) => {
      log('A pooled database connection failed.', error);
    });
  // pg's pool listens for a connection's errors only while it is idle. This
  // listener stays for the connection's whole life, so a failure between
  // queries on a checked-out connection cannot end the process.
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      try {
        onIdleError(error);
      } catch {
        // A failing callback must not end the process.
      }
    });
  });
  // The pool repeats an idle connection's error, already reported above.
  pool.on('error', () => undefined);

  const db = kyselyOver<DB>(pool);
  internals.set(db, { pool, log });
  return db;
}

/** `log`, except that an error it throws is dropped. */
function neverThrows(log: DatabaseLog): DatabaseLog {
  return (message, error) => {
    try {
      log(message, error);
    } catch {
      // A failing logger must not end the process or leak a connection.
    }
  };
}

/** The driver settings for `settings`. Exported for tests only. */
export function poolConfig(settings: DatabaseSettings): pg.PoolConfig {
  // Settings may come from configuration files, so check them at run time
  // as well as in the type. An empty value would let pg read a PG* variable.
  if (!(CLIENT_ROLES as readonly string[]).includes(settings.role)) {
    throw new Error(`The database client connects only as ${CLIENT_ROLES.join(', ')}.`);
  }
  if (!settings.host || !settings.database || !settings.password) {
    throw new Error('Set the database host, name and password. None of them may be empty.');
  }
  const { port } = settings;
  const statementTimeout = settings.statementTimeoutMillis ?? 30_000;
  const idleTimeout = settings.idleInTransactionTimeoutMillis ?? 60_000;
  const queryTimeout = settings.queryTimeoutMillis ?? 35_000;
  const keepAliveDelay = settings.keepAliveInitialDelayMillis ?? 10_000;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('The database port must be a whole number from 1 to 65535.');
  }
  const timeouts = [statementTimeout, idleTimeout, queryTimeout, keepAliveDelay];
  if (!timeouts.every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error('The database timeouts must be whole numbers of milliseconds.');
  }
  return {
    host: settings.host,
    port,
    database: settings.database,
    user: settings.role,
    password: settings.password,
    application_name: settings.applicationName,
    max: settings.maxConnections ?? 10,
    connectionTimeoutMillis: settings.connectionTimeoutMillis ?? 10_000,
    query_timeout: queryTimeout,
    keepAlive: true,
    keepAliveInitialDelayMillis: keepAliveDelay,
    ssl: sslOption(settings),
    sslnegotiation: 'postgres',
    // Startup options outlast DISCARD ALL, and setting them here stops
    // PGOPTIONS adding any.
    options: `-c statement_timeout=${statementTimeout} -c idle_in_transaction_session_timeout=${idleTimeout}`,
  };
}

/** Always a definite value, so PGSSLMODE never decides. */
function sslOption({ host, tls }: DatabaseSettings): NonNullable<pg.PoolConfig['ssl']> {
  const mode = tls?.mode ?? (isLoopbackHost(host) ? 'disable' : undefined);
  if (mode === 'disable') return false;
  if (mode === 'verify-full') {
    return tls?.ca ? { rejectUnauthorized: true, ca: tls.ca } : { rejectUnauthorized: true };
  }
  throw new Error(
    `Set tls.mode for the database server at ${host} to verify-full, or to disable on a private network. Only a server on this machine is reached without TLS by default.`,
  );
}

/** Kysely over `pool`, built the same way for every client in this package. */
function kyselyOver<DB>(pool: PostgresPool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** The pool and log behind a client that createDatabase() made. */
export function internalsOf(db: object): DatabaseInternals {
  const found = internals.get(db);
  if (!found) {
    throw new Error('Use a client from createDatabase(), not a transaction or another client.');
  }
  return found;
}

/**
 * Kysely over one checked-out connection. Kysely's own release of it does
 * nothing, so the caller decides whether it goes back to the pool or is
 * closed.
 */
export function kyselyOn<DB>(client: pg.PoolClient): Kysely<DB> {
  const connection: PostgresPoolClient = {
    query: client.query.bind(client),
    release: () => undefined,
  };
  return kyselyOver<DB>({
    connect: () => Promise.resolve(connection),
    end: () => Promise.resolve(),
    options: {},
  });
}
