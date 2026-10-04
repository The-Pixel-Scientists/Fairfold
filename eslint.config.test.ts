// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The module boundaries in eslint.config.js (ADR 0016): imports each entry
// point may make, by any means of loading a module, and imports it may not.

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { moduleBoundaries } from './eslint.config.js';

const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
    ...moduleBoundaries,
  ],
});

/** The boundary messages ESLint reports for one line of code in a file. */
async function boundaryMessages(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\n`, { filePath: file });
  const messages = result?.messages ?? [];
  expect(messages.filter((message) => message.fatal)).toEqual([]);
  return messages.map((message) => message.message);
}

const contracts = 'modules/party/src/contracts/person.ts';
const server = 'modules/grants/src/server/decisions.ts';
const consoleScreen = 'modules/party/src/console/People.tsx';
const portalScreen = 'modules/grants/src/portal/Apply.tsx';

describe('module boundaries', () => {
  it.each([
    [contracts, 'zod'],
    [contracts, '@pixel-scientists/domain'],
    [contracts, '@pixel-scientists/domain/api'],
    [contracts, '@pixel-scientists/grants/contracts'],
    [contracts, './consent.ts'],
    [server, '../contracts/index.ts'],
    [server, './release.ts'],
    [server, '@pixel-scientists/db'],
    [server, '@pixel-scientists/db/generated/grants'],
    [server, '@pixel-scientists/domain'],
    [server, '@pixel-scientists/party/contracts'],
    [server, '@pixel-scientists/party/server'],
    [consoleScreen, 'react'],
    [consoleScreen, '@pixel-scientists/ui'],
    [consoleScreen, '@pixel-scientists/domain/forms'],
    [consoleScreen, '../contracts/index.ts'],
    [consoleScreen, './PersonTable.tsx'],
    [portalScreen, '@pixel-scientists/party/contracts'],
    [portalScreen, '../contracts/index.ts'],
    ['modules/party/src/server/people.test.ts', 'vitest'],
    ['apps/api/src/modules.ts', '@pixel-scientists/party/server'],
    ['apps/console/src/main.tsx', '@pixel-scientists/grants/console'],
  ])('lets %s import %s', async (file, specifier) => {
    await expect(boundaryMessages(file, `import '${specifier}';`)).resolves.toEqual([]);
  });

  it.each([
    [contracts, 'react'],
    [contracts, 'node:crypto'],
    [contracts, '@pixel-scientists/db'],
    [contracts, '@pixel-scientists/ui'],
    [contracts, '@pixel-scientists/grants/server'],
    [contracts, '../server/people.ts'],
    [contracts, '../console/index.ts'],
    [server, '@pixel-scientists/db/generated/party'],
    [server, '@pixel-scientists/party/server/people.ts'],
    [server, '@pixel-scientists/party/console'],
    [server, '@pixel-scientists/ui'],
    [server, 'kysely'],
    [server, '../portal/index.ts'],
    [server, '../../../party/src/server/people.ts'],
    [server, '../../../../apps/api/src/app.ts'],
    [consoleScreen, '@pixel-scientists/db'],
    [consoleScreen, '@pixel-scientists/party/server'],
    [consoleScreen, '@pixel-scientists/grants/console'],
    [consoleScreen, '../server/index.ts'],
    [consoleScreen, '../portal/index.ts'],
    [portalScreen, '@pixel-scientists/party/server'],
    [portalScreen, '../console/index.ts'],
    [portalScreen, 'zod'],
  ])('refuses %s an import of %s', async (file, specifier) => {
    const messages = await boundaryMessages(file, `import '${specifier}';`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('(ADR 0016).');
  });

  it.each([
    [server, "await import('@pixel-scientists/party/console');"],
    [server, "await import('kysely');"],
    [server, 'await import(`kysely`);'],
    [server, 'await import(name);'],
    [server, "type Builder = import('kysely').Kysely<never>;"],
    [server, "import pg = require('pg');"],
    [server, "process.getBuiltinModule('node:child_process');"],
    [server, "import.meta.resolve('pg');"],
    [consoleScreen, "require('@pixel-scientists/db');"],
    [consoleScreen, "require.resolve('@pixel-scientists/db');"],
    [consoleScreen, 'require(name);'],
    [server, "import '../shared/sql.ts';"],
    [server, "import './node_modules/pg/lib/index.js';"],
    [server, "import '../../../../node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js';"],
    [server, "import '../../../../scripts/dev-env.ts';"],
    [server, "import './release.test.ts';"],
  ])('refuses %s the code %s', async (file, code) => {
    const messages = await boundaryMessages(file, code);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('(ADR 0016).');
  });

  it.each([
    [consoleScreen, "const People = lazy(() => import('./People.tsx'));"],
    [server, "const party = await import('@pixel-scientists/party/server');"],
    [contracts, 'await import(`./consent.ts`);'],
  ])('lets %s run %s', async (file, code) => {
    await expect(boundaryMessages(file, code)).resolves.toEqual([]);
  });

  it.each([
    'modules/party/src/shared/sql.ts',
    'modules/party/src/index.ts',
    'modules/party/src/constructor/index.ts',
    'modules/party/lib/sql.ts',
    'modules/party/src/shared/sql.test.ts',
    'modules/finance/src/server/index.ts',
  ])('refuses module code outside an entry point: %s', async (file) => {
    const messages = await boundaryMessages(file, 'export const loaded = true;');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('(ADR 0016).');
  });

  it('refuses type-only imports and re-exports alike', async () => {
    await expect(
      boundaryMessages(contracts, "import type { ReactNode } from 'react';"),
    ).resolves.toHaveLength(1);
    await expect(
      boundaryMessages(consoleScreen, "export * from '@pixel-scientists/party/server';"),
    ).resolves.toHaveLength(1);
  });
});
