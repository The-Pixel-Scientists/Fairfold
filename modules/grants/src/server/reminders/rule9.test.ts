// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sources = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => [name, readFileSync(join(import.meta.dirname, name), 'utf8')] as const);

describe('reminders only remind (rule 9)', () => {
  it('write no table but the reminder outbox and settings', () => {
    const writes = sources.flatMap(([name, text]) =>
      [...text.matchAll(/\.(?:insertInto|updateTable|deleteFrom)\('([^']+)'\)/g)].map(
        (match) => `${name}: ${match[1]}`,
      ),
    );
    const allowed = new Set([
      'handlers.ts: grants.reminder_setting',
      'scan.ts: grants.reminder_email',
      'send.ts: grants.reminder_email',
    ]);
    expect(writes.filter((write) => !allowed.has(write))).toEqual([]);
  });

  it('import no service that changes an application, an assignment or a decision', () => {
    const allowed = new Set([
      '../../contracts/index.ts',
      '../programme/context.ts',
      '../programme/read.ts',
      '../programme/tables.ts',
      '../notes/application.ts',
      '../decisions/context.ts',
    ]);
    const imports = sources.flatMap(([name, text]) =>
      [...text.matchAll(/from '(\.\.\/[^']+)'/g)].map((match) => [name, match[1] ?? ''] as const),
    );
    expect(imports.filter(([, path]) => !allowed.has(path))).toEqual([]);
  });
});
