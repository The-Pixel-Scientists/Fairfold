// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for database-roles.yaml, checked by `semgrep --test infra/semgrep`.

import { CLIENT_ROLES, createDatabase, type ClientRole, type DatabaseSettings } from '@pixel-scientists/db';
// ruleid: tps-app-auth-only-in-auth
import { createDatabase as connect } from '@pixel-scientists/db';

declare const password: string;
declare const settings: DatabaseSettings;
const server = { host: '127.0.0.1', port: 5432, database: 'tps', password, applicationName: 'x' };

// ok: tps-app-auth-only-in-auth
createDatabase({ host: '127.0.0.1', port: 5432, database: 'tps', role: 'app_api', password, applicationName: 'x' });

// ok: tps-app-auth-only-in-auth
createDatabase<unknown>({ host: '127.0.0.1', port: 5432, database: 'tps', role: 'app_worker', password, applicationName: 'x' });

// ruleid: tps-app-auth-only-in-auth
createDatabase({ host: '127.0.0.1', port: 5432, database: 'tps', role: 'app_auth', password, applicationName: 'x' });

// ruleid: tps-app-auth-only-in-auth
createDatabase({ host: '127.0.0.1', port: 5432, database: 'tps', role: CLIENT_ROLES[2], password, applicationName: 'x' });

const ROLES = { auth: 'app_auth' } as const;
// ruleid: tps-app-auth-only-in-auth
createDatabase({ host: '127.0.0.1', port: 5432, database: 'tps', role: ROLES.auth, password, applicationName: 'x' });

// ruleid: tps-app-auth-only-in-auth
createDatabase(settings);

// ruleid: tps-app-auth-only-in-auth
createDatabase({ role: 'app_api', ...server });

export function open(role: ClientRole) {
  // ruleid: tps-app-auth-only-in-auth
  return createDatabase({ host: '127.0.0.1', port: 5432, database: 'tps', role, password, applicationName: 'x' });
}

connect(settings);
