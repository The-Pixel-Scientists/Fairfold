// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the worker needs to call a request's provider (ADR 0040): the adapter
// for its connection's provider key, and the connection's account with its
// token opened for this one call. The sealed token is read through
// app_worker's column grant and opened by `open`, which the worker is given;
// the token is never logged, put in a URL or stored again.

import type { Transaction } from '@pixel-scientists/db';
import type { ProviderConnection, SignatureProvider } from '@pixel-scientists/domain/documents';

import type { SignatureProviders } from './registry.ts';
import type { EsignTables } from './tables.ts';

/** A connection's sealed token and where it is bound, as stored. */
export interface SealedConnection {
  readonly tenantId: string;
  readonly id: string;
  readonly accountId: string;
  readonly apiToken: Buffer;
  readonly keyVersion: number;
}

export interface ProviderDependencies {
  readonly providers: SignatureProviders;
  /** Opens a connection's sealed API token for one call. */
  readonly open: (connection: SealedConnection) => ProviderConnection;
}

export interface LiveProvider {
  readonly adapter: SignatureProvider;
  readonly connection: ProviderConnection;
}

/** The adapter and account of an active connection, or undefined when there is none to call. */
export async function liveProvider(
  trx: Transaction<unknown>,
  deps: ProviderDependencies,
  connectionId: string,
): Promise<LiveProvider | undefined> {
  const row = await trx
    .$extendTables<EsignTables>()
    .selectFrom('app.signature_connection')
    .select([
      'tenant_id',
      'id',
      'provider',
      'status',
      'account_id',
      'api_token',
      'api_token_key_version',
    ])
    .where('id', '=', connectionId)
    .executeTakeFirst();
  const adapter = row?.status === 'active' ? deps.providers(row.provider) : undefined;
  if (row === undefined || adapter === undefined) return undefined;
  return {
    adapter,
    connection: deps.open({
      tenantId: row.tenant_id,
      id: row.id,
      accountId: row.account_id,
      apiToken: row.api_token,
      keyVersion: row.api_token_key_version,
    }),
  };
}
