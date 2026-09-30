// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for raw-sql.yaml, checked by `semgrep --test infra/semgrep`.

import { CompiledQuery, sql } from 'kysely';

declare const input: string;
declare const tenantId: string;

// ruleid: pixelgrant-no-raw-sql
sql.raw(`SELECT * FROM app.tenant WHERE id = '${input}'`);

// ruleid: pixelgrant-no-raw-sql
sql.lit(input);

// ruleid: pixelgrant-no-raw-sql
CompiledQuery.raw(input);

// ok: pixelgrant-no-raw-sql
sql`SELECT * FROM app.tenant WHERE id = ${tenantId}`;

// ruleid: pixelgrant-no-dynamic-sql-identifier
sql.id(input);

// ruleid: pixelgrant-no-dynamic-sql-identifier
sql.ref(`app.${input}`);

// ruleid: pixelgrant-no-dynamic-sql-identifier
sql.table(input);

// ok: pixelgrant-no-dynamic-sql-identifier
sql.table('app.tenant');

// ok: pixelgrant-no-dynamic-sql-identifier
sql.ref('tenant.id');
