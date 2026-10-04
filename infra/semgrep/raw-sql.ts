// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for raw-sql.yaml, checked by `semgrep --test infra/semgrep`.

import { CompiledQuery, sql, type Kysely } from 'kysely';

declare const input: string;
declare const tenantId: string;

// ruleid: tps-no-raw-sql
sql.raw(`SELECT * FROM app.tenant WHERE id = '${input}'`);

// ruleid: tps-no-raw-sql
sql.lit(input);

// ruleid: tps-no-raw-sql
CompiledQuery.raw(input);

// ruleid: tps-no-raw-sql
sql(Object.assign([`SELECT * FROM app.tenant WHERE id = '${input}'`], { raw: [] }));

// ok: tps-no-raw-sql
sql`SELECT * FROM app.tenant WHERE id = ${tenantId}`;

// ok: tps-no-raw-sql
sql<number>`SELECT count(*) FROM app.tenant`;

declare const db: Kysely<unknown>;
declare const compiled: CompiledQuery;

// ruleid: tps-no-execute-query
await db.executeQuery(compiled);

// ruleid: tps-no-execute-query
await db.executeQuery({ sql: input, parameters: [], query: compiled.query, queryId: compiled.queryId });

// ok: tps-no-execute-query
await sql`SELECT 1`.execute(db);

// ruleid: tps-no-dynamic-sql-identifier
sql.id(input);

// ruleid: tps-no-dynamic-sql-identifier
sql.ref(`app.${input}`);

// ruleid: tps-no-dynamic-sql-identifier
sql.table(input);

// ok: tps-no-dynamic-sql-identifier
sql.table('app.tenant');

// ok: tps-no-dynamic-sql-identifier
sql.ref('tenant.id');

declare const vi: { fn: (implementation: () => unknown) => unknown };

await db.selectNoFrom((eb) => [
  // ruleid: tps-no-dynamic-sql-function
  eb.fn(input, [eb.val(tenantId)]).as('a'),
  // ruleid: tps-no-dynamic-sql-function
  eb.fn<string>(`set_${input}`, []).as('b'),
  // ruleid: tps-no-dynamic-sql-function
  eb.fn.agg(input, []).as('c'),
  // ok: tps-no-dynamic-sql-function
  eb.fn('upper', [eb.val(tenantId)]).as('d'),
  // ok: tps-no-dynamic-sql-function
  eb.fn.agg<number>('count', []).as('e'),
]);

await db.selectNoFrom(({ fn }) => [
  // ruleid: tps-no-dynamic-sql-function
  fn(input, []).as('f'),
  // ok: tps-no-dynamic-sql-function
  fn.count('id').as('g'),
]);

await db.selectNoFrom((eb) => {
  // ruleid: tps-no-dynamic-sql-function
  const { fn: call } = eb;
  // ruleid: tps-no-dynamic-sql-function
  const alias = eb.fn;
  // ruleid: tps-no-dynamic-sql-function
  const indexed = eb['fn'];
  // ok: tps-no-dynamic-sql-function
  const { fn } = eb;
  return [call(input, []).as('h'), alias(input, []).as('i'), indexed(input, []).as('j'), fn.max('id').as('k')];
});

// ruleid: tps-no-dynamic-sql-function
await db.selectNoFrom(({ fn: call }) => [call(input, []).as('l')]);

// ruleid: tps-no-dynamic-sql-function
export function count({ fn: call }: { fn: (name: string, args: []) => unknown }) {
  return call(input, []);
}

// ok: tps-no-dynamic-sql-function
vi.fn(() => undefined);
