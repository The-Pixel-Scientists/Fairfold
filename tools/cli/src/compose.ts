// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Compose file install writes beside the secrets. It names each secret
// file and holds no value, so Compose mounts each file under /run/secrets
// in only the containers that list it, and the services read them through
// their *_FILE settings. Pass it after the deployment's own Compose file,
// whose secrets have the same names.

import { join } from 'node:path';

import { SECRET_NAMES } from './secrets.ts';

export const COMPOSE_FILE = 'compose.secrets.yaml';

export function composeSecrets(folder: string): string {
  // A JSON string is a YAML double-quoted scalar, so any path is quoted safely.
  const entries = SECRET_NAMES.map(
    (name) => `  ${name}:\n    file: ${JSON.stringify(join(folder, name))}\n`,
  );
  return [
    '# Made by tps install. Each entry names a secret file; no value is written here.\n',
    'secrets:\n',
    ...entries,
  ].join('');
}
