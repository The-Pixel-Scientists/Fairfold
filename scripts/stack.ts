// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm stack` (ADR 0005): build the release images, then run PostgreSQL,
// the migrations, the API, the console, the portal, the reverse proxy and
// Mailpit in containers, as a self-hosted install runs them
// (infra/compose/compose.stack.yaml).
//
//   node scripts/stack.ts                    build, start and wait until ready
//   node scripts/stack.ts seed [arguments]   run the development seed against
//                                            the stack's database
//   node scripts/stack.ts down [--volumes]   stop; --volumes also deletes the
//                                            data and the secrets
//   node scripts/stack.ts <command...>       any other Compose command, such
//                                            as `logs api`
//
// Each worktree has its own Compose project and ports (dev-names.ts). Its
// secrets are random, made on the first start, and kept outside the checkout
// in ~/.tps/stack/<project>, one file each, readable by this user
// only. Compose copies each into only the containers that use it. The seed
// password stays in that folder; the seed reads it from there.
//
// SeaweedFS takes one random key per S3 identity (admin, write and read) and
// four random keys its own servers sign their requests with. This script
// builds its identities and security files from them, and Compose gives the
// API the write and read keys only, and the bucket job the admin key.
//
// The reverse proxy (ADR 0030) is the only way in. It serves the console at
// https://console.localhost and the portal at https://portal.localhost, each
// on its own port, with a certificate this script makes for those two hosts
// and keeps with the other secrets; plain HTTP on a third port only
// redirects. The proxy reaches the API over a network of their own, `web`,
// which this script makes before Compose starts so that it can tell the API
// to trust the forwarding headers of that network's addresses only.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ensureSecretFile, withoutOurVariables } from './dev-env.ts';
import { currentDevNames, repositoryRoot } from './dev-names.ts';

/** The variables compose.stack.yaml reads its secrets from. The first is the superuser's. */
const SECRETS = [
  'TPS_STACK_POSTGRES_PASSWORD',
  'TPS_STACK_MIGRATOR_PASSWORD',
  'TPS_STACK_APP_API_PASSWORD',
  'TPS_STACK_APP_WORKER_PASSWORD',
  'TPS_STACK_APP_AUTH_PASSWORD',
  'TPS_STACK_APP_QUEUE_PASSWORD',
  'TPS_STACK_BACKUP_READER_PASSWORD',
  'TPS_STACK_AUTH_SECRET',
  'TPS_STACK_REQUEST_LIMIT_KEY',
  'TPS_STACK_SUBJECT_KEK',
  'TPS_STACK_STORAGE_ADMIN_SECRET_KEY',
  'TPS_STACK_STORAGE_WRITE_SECRET_KEY',
  'TPS_STACK_STORAGE_READ_SECRET_KEY',
  'TPS_STACK_STORAGE_SCANNER_SECRET_KEY',
  'TPS_STACK_STORAGE_REMOVAL_SECRET_KEY',
  'TPS_STACK_STORAGE_JWT_WRITE_KEY',
  'TPS_STACK_STORAGE_JWT_READ_KEY',
  'TPS_STACK_STORAGE_JWT_FILER_WRITE_KEY',
  'TPS_STACK_STORAGE_JWT_FILER_READ_KEY',
] as const;

/** The bucket compose.stack.yaml creates and the API uses. */
const STACK_BUCKET = 'tps-files';

/** The database compose.stack.yaml migrates. */
const STACK_DATABASE = 'tps';

const SEED_SCRIPT = join(repositoryRoot, 'packages', 'db', 'seed', 'seed.ts');

/**
 * The environment for the seed against the stack: none of the caller's
 * TPS_ variables, the tunnel's port on this machine, the stack's
 * database as the only one it may fill, and migrator's password and the seed
 * password as files in the stack's secrets folder.
 */
export function seedEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  port: string,
  secrets: string,
): Record<string, string> {
  return {
    ...withoutOurVariables(inherited),
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DB_PORT: port,
    TPS_DB_NAME: STACK_DATABASE,
    TPS_DEV_DATABASES: STACK_DATABASE,
    TPS_DB_MIGRATOR_PASSWORD_FILE: join(secrets, 'TPS_STACK_MIGRATOR_PASSWORD'),
    TPS_SEED_PASSWORD_FILE: join(secrets, 'TPS_STACK_SEED_PASSWORD'),
  };
}

/** A generated secret, which loadSecrets() has always made. */
function secret(secrets: Readonly<Record<string, string>>, name: string): string {
  const value = secrets[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

/**
 * SeaweedFS's S3 identities (ADR 0030, 0047): admin may only create the
 * bucket, write may only write under clean/, read may only read there,
 * scanner reads clean/ and reads and writes withheld/, and removal (the
 * worker's) lists and deletes under clean/ and withheld/. The access key ids
 * match compose.stack.yaml.
 */
export function storageIdentities(secrets: Readonly<Record<string, string>>): string {
  const identity = (name: string, purpose: string, actions: string | string[]) => ({
    name,
    credentials: [
      { accessKey: name, secretKey: secret(secrets, `TPS_STACK_STORAGE_${purpose}_SECRET_KEY`) },
    ],
    actions: [actions].flat(),
  });
  return JSON.stringify({
    identities: [
      identity('tps-admin', 'ADMIN', `Admin:${STACK_BUCKET}`),
      identity('tps-write', 'WRITE', `Write:${STACK_BUCKET}/clean/*`),
      identity('tps-read', 'READ', `Read:${STACK_BUCKET}/clean/*`),
      identity('tps-scanner', 'SCANNER', [
        `Read:${STACK_BUCKET}/clean/*`,
        `Read:${STACK_BUCKET}/withheld/*`,
        `Write:${STACK_BUCKET}/withheld/*`,
      ]),
      identity('tps-removal', 'REMOVAL', [
        `List:${STACK_BUCKET}/clean/*`,
        `Delete:${STACK_BUCKET}/clean/*`,
        `List:${STACK_BUCKET}/withheld/*`,
        `Delete:${STACK_BUCKET}/withheld/*`,
      ]),
    ],
  });
}

/** SeaweedFS's security.toml: the keys its master, volume and filer sign requests with. */
export function storageSecurity(secrets: Readonly<Record<string, string>>): string {
  const tables = {
    'jwt.signing': 'WRITE',
    'jwt.signing.read': 'READ',
    'jwt.filer_signing': 'FILER_WRITE',
    'jwt.filer_signing.read': 'FILER_READ',
  };
  return Object.entries(tables)
    .map(([table, key]) => {
      const value = secret(secrets, `TPS_STACK_STORAGE_JWT_${key}_KEY`);
      return `[${table}]\nkey = "${value}"\n`;
    })
    .join('');
}

/** The address Docker published a port on, as `docker compose port` prints it. */
export function publishedPort(output: string): string {
  const port = /^127\.0\.0\.1:([0-9]{1,5})$/.exec(output.trim())?.[1];
  if (port === undefined) throw new Error(`Docker published the tunnel at ${output.trim()}.`);
  return port;
}

/** The host names the proxy serves, as compose.stack.yaml names them. */
export const STACK_HOSTS = ['console.localhost', 'portal.localhost'] as const;

/** Days a stack certificate is valid for; one with less than a week left is made again. */
const CERTIFICATE_DAYS = 365;
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/** A DER element: tag, definite length, contents. */
function der(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  const length: number[] = [];
  for (let rest = body.length; rest > 0; rest >>= 8) length.unshift(rest & 0xff);
  const header = body.length < 0x80 ? [body.length] : [0x80 | length.length, ...length];
  return Buffer.concat([Buffer.from([tag, ...header]), body]);
}

const sequence = (...contents: Buffer[]) => der(0x30, ...contents);
const ECDSA_WITH_SHA256 = sequence(Buffer.from('06082a8648ce3d040302', 'hex'));

/** UTCTime, which X.509 uses for dates before 2050. */
function utcTime(date: Date): Buffer {
  return der(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
}

/**
 * A self-signed P-256 certificate for `hosts`, for the stack's proxy only,
 * with the hosts as its subject alternative names and server authentication
 * as its one use. Returns the certificate and its private key in PEM.
 */
export function selfSignedCertificate(
  hosts: readonly string[],
  now = new Date(),
): { certificate: string; key: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serial = randomBytes(16);
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;
  const name = sequence(
    der(0x31, sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('Local stack')))),
  );
  const extension = (oid: string, value: Buffer) =>
    sequence(Buffer.from(oid, 'hex'), der(0x04, value));
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ECDSA_WITH_SHA256,
    name,
    sequence(
      utcTime(new Date(now.getTime() - 60 * 60 * 1000)),
      utcTime(new Date(now.getTime() + CERTIFICATE_DAYS * 24 * 60 * 60 * 1000)),
    ),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(
      0xa3,
      sequence(
        extension('0603551d11', sequence(...hosts.map((host) => der(0x82, Buffer.from(host))))),
        extension('0603551d25', sequence(Buffer.from('06082b06010505070301', 'hex'))),
      ),
    ),
  );
  const signature = sign('sha256', tbs, privateKey);
  const certificate = sequence(tbs, ECDSA_WITH_SHA256, der(0x03, Buffer.from([0]), signature));
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    certificate: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** The base64 SHA-256 of a certificate's public key, as Chromium's SPKI allowlist takes it. */
export function publicKeyHash(certificate: string): string {
  const key: KeyObject = new X509Certificate(certificate).publicKey;
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('base64');
}

const names = currentDevNames();
const project = names.stackProject;
const secretsFolder = join(homedir(), '.tps', 'stack', project);
const webNetwork = `${project}_web`;
const ports = {
  // The proxy's plain HTTP port, which only redirects. The API publishes no
  // port of its own, so the stack uses that one's number.
  TPS_STACK_HTTP_PORT: String(names.ports.stackApi),
  TPS_STACK_CONSOLE_PORT: String(names.ports.stackConsole),
  TPS_STACK_PORTAL_PORT: String(names.ports.stackPortal),
  TPS_STACK_MAIL_PORT: String(names.ports.stackMail),
};

/** Where this worktree's stack keeps the proxy's certificate. */
export const STACK_CERTIFICATE = join(secretsFolder, 'TPS_STACK_PROXY_CERTIFICATE');
const STACK_CERTIFICATE_KEY = join(secretsFolder, 'TPS_STACK_PROXY_KEY');

/** Make the proxy's certificate and key unless a current pair is there. */
function ensureCertificate(): void {
  if (existsSync(STACK_CERTIFICATE) && existsSync(STACK_CERTIFICATE_KEY)) {
    const validTo = Date.parse(new X509Certificate(readFileSync(STACK_CERTIFICATE)).validTo);
    if (validTo - Date.now() > RENEW_BEFORE_MS) return;
  }
  const { certificate, key } = selfSignedCertificate(STACK_HOSTS);
  writeFileSync(STACK_CERTIFICATE_KEY, key, { mode: 0o600 });
  writeFileSync(STACK_CERTIFICATE, certificate, { mode: 0o600 });
}

/**
 * Read the secrets, making any that are missing. A new superuser password
 * cannot open a database made with the old one, so that is refused.
 */
function loadSecrets(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of SECRETS) {
    const path = join(secretsFolder, name);
    if (name === SECRETS[0] && !existsSync(path) && volumeExists('postgres-data')) {
      throw new Error(
        `The stack's database was made with a superuser password that is no longer in ` +
          `${secretsFolder}. Delete the stack's data with: pnpm stack down --volumes`,
      );
    }
    ensureSecretFile(path);
    values[name] = readFileSync(path, 'utf8');
  }
  values['TPS_STACK_STORAGE_IDENTITIES'] = storageIdentities(values);
  values['TPS_STACK_STORAGE_SECURITY'] = storageSecurity(values);
  ensureCertificate();
  values['TPS_STACK_PROXY_CERTIFICATE'] = readFileSync(STACK_CERTIFICATE, 'utf8');
  values['TPS_STACK_PROXY_KEY'] = readFileSync(STACK_CERTIFICATE_KEY, 'utf8');
  return values;
}

function volumeExists(volume: string): boolean {
  const result = spawnSync('docker', ['volume', 'inspect', `${project}_${volume}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

/** The address ranges of the `web` network, comma-separated, or '' if it does not exist. */
function webSubnets(): string {
  const result = spawnSync(
    'docker',
    ['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}', webNetwork],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return result.status === 0 ? result.stdout.trim().split(/\s+/).join(',') : '';
}

/** Make the `web` network, with no way out, unless it is there. */
function createWebNetwork(): void {
  if (webSubnets() !== '') return;
  const result = spawnSync('docker', ['network', 'create', '--internal', webNetwork], {
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error(`Could not create the Docker network ${webNetwork}.`);
}

function compose(
  args: readonly string[],
  options: { secrets?: Record<string, string>; capture?: boolean } = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--file',
      join(repositoryRoot, 'infra', 'compose', 'compose.stack.yaml'),
      ...args,
    ],
    {
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
      env: {
        ...process.env,
        ...ports,
        ...options.secrets,
        TPS_STACK_WEB_NETWORK: webNetwork,
        TPS_STACK_WEB_SUBNETS: webSubnets(),
      },
    },
  );
}

/**
 * Whether `/api/` on an app's host reaches the API through the proxy, over
 * TLS checked against the stack's own certificate. The API names every answer.
 */
function reachesApi(host: string, port: string): Promise<boolean> {
  return new Promise((resolve) => {
    const call = request(
      {
        host: '127.0.0.1',
        port,
        servername: host,
        path: '/api/',
        headers: { host: `${host}:${port}` },
        ca: readFileSync(STACK_CERTIFICATE),
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        resolve(response.headers['x-request-id'] !== undefined);
      },
    );
    call.on('error', () => {
      resolve(false);
    });
    call.on('timeout', () => {
      call.destroy();
    });
    call.end();
  });
}

async function up(): Promise<number> {
  createWebNetwork();
  const { status } = compose(
    ['up', '--build', '--detach', '--wait', 'proxy', 'mail-forward-api', 'mail-forward-worker'],
    {
      secrets: loadSecrets(),
    },
  );
  if (status !== 0) return status ?? 1;

  const [consoleHost, portalHost] = STACK_HOSTS;
  const reached = await Promise.all([
    reachesApi(consoleHost, ports.TPS_STACK_CONSOLE_PORT),
    reachesApi(portalHost, ports.TPS_STACK_PORTAL_PORT),
  ]);
  if (reached.includes(false)) console.error('The proxy does not reach the API.');
  console.log(`Console: https://${consoleHost}:${ports.TPS_STACK_CONSOLE_PORT}`);
  console.log(`Portal:  https://${portalHost}:${ports.TPS_STACK_PORTAL_PORT}`);
  console.log(`Mailpit: http://127.0.0.1:${ports.TPS_STACK_MAIL_PORT}`);
  console.log(`The certificate for both, made for this stack: ${STACK_CERTIFICATE}`);
  console.log('Fill it with synthetic data with: pnpm stack seed');
  console.log('Stop it with: pnpm stack down');
  return reached.includes(false) ? 1 : 0;
}

/** Run the seed on this machine, through a tunnel to the stack's database. */
function seed(args: readonly string[]): number {
  const secrets = loadSecrets();
  ensureSecretFile(join(secretsFolder, 'TPS_STACK_SEED_PASSWORD'));
  const { status } = compose(['up', '--build', '--detach', '--wait', 'database-tunnel'], {
    secrets,
  });
  if (status !== 0) return status ?? 1;
  try {
    const published = compose(['port', 'database-tunnel', '5432'], { capture: true });
    const result = spawnSync(process.execPath, [SEED_SCRIPT, ...args], {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: seedEnvironment(process.env, publishedPort(published.stdout), secretsFolder),
    });
    return result.status ?? 1;
  } finally {
    compose(['rm', '--stop', '--force', 'database-tunnel']);
  }
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0) return up();
  if (args[0] === 'seed') return seed(args.slice(1));
  const status = compose(args).status ?? 1;
  if (status === 0 && args[0] === 'down') {
    spawnSync('docker', ['network', 'rm', webNetwork], { stdio: 'ignore' });
    if (args.some((arg) => arg === '--volumes' || arg === '-v')) {
      rmSync(secretsFolder, { recursive: true, force: true });
    }
  }
  return status;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2).filter((arg) => arg !== '--'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
