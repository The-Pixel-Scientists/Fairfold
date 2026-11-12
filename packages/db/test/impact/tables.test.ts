// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Frameworks, outcomes, indicators, targets, results, evidence and learning
// notes (migration 0067): app_api writes only what its grants allow, the
// database sets the times, a framework's version follows its changes (rule
// 10), an archived framework and everything under it stay as they are, an
// indicator in use keeps its unit and its place, and evidence links its
// file. No impact right reaches any other app role.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { addFile } from '../grants/application-fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addImpactParts,
  evidenceRow,
  frameworkRow,
  indicatorRow,
  insertOutcome,
  noteRow,
  outcomeRow,
  resultRow,
  targetRow,
  type ImpactParts,
} from './fixtures.ts';

const IMPACT_TABLES = [
  'impact.framework',
  'impact.outcome',
  'impact.indicator',
  'impact.target',
  'impact.result',
  'impact.result_evidence',
  'impact.learning_note',
];

let tenant: TestTenant;
let parts: ImpactParts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addImpactParts(client, tenant));
}, 60_000);

const asApi = (text: string, values: readonly unknown[]) =>
  asRoleIn('app_api', tenant.id, (client) => outcome(client, text, values));
const insert = (table: string, row: Readonly<Record<string, unknown>>) =>
  insertOutcome('app_api', tenant, `impact.${table}`, row);
/** New parts of the tenant's, for a test that changes them. */
const moreParts = (unit = 'count') =>
  asMigratorIn(tenant.id, (client) => addImpactParts(client, tenant, unit));

describe('impact grants', () => {
  it('give app_worker, app_auth, app_queue and PUBLIC nothing', async () => {
    const { rows } = await withClient('migrator', (client) =>
      client.query<{ role: string; table: string }>(
        `SELECT r.role, t.name AS table
           FROM pg_catalog.unnest($1::text[]) AS t(name)
          CROSS JOIN pg_catalog.unnest(ARRAY['app_worker', 'app_auth', 'app_queue', 'public'])
                AS r(role)
          WHERE pg_catalog.has_any_column_privilege(r.role, t.name::regclass,
                  'SELECT, INSERT, UPDATE, REFERENCES')
             OR pg_catalog.has_table_privilege(r.role, t.name::regclass, 'DELETE, TRUNCATE, TRIGGER')`,
        [IMPACT_TABLES],
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe('database-set times', { timeout: 30_000 }, () => {
  it('ignore what migrator supplies and are not granted to app_api', async () => {
    const past = '2000-01-01T00:00:00Z';
    const stamped = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'impact.framework',
        frameworkRow(tenant, parts.member, { created_at: past, updated_at: past }),
      );
      await client.query('UPDATE impact.framework SET archived_at = $2 WHERE id = $1', [id, past]);
      const { rows } = await client.query<Record<string, Date>>(
        'SELECT created_at, updated_at, archived_at FROM impact.framework WHERE id = $1',
        [id],
      );
      return rows[0] ?? {};
    });
    for (const time of Object.values(stamped)) expect(time.getFullYear()).toBeGreaterThan(2000);
    for (const [table, row] of [
      ['framework', frameworkRow(tenant, parts.member)],
      ['outcome', outcomeRow(tenant, parts.framework, { position: 1 })],
      ['target', targetRow(tenant, parts)],
      ['result', resultRow(tenant, parts)],
      ['learning_note', noteRow(tenant, parts)],
    ] as const) {
      expect(await insert(table, { ...row, created_at: past }), table).toBe('42501');
    }
  });
});

describe('impact.framework', { timeout: 30_000 }, () => {
  it('keeps a name unique among unarchived frameworks, whatever its case', async () => {
    const name = `Synthetic framework ${randomUUID()}`;
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'impact.framework', frameworkRow(tenant, parts.member, { name })),
    );
    const again = frameworkRow(tenant, parts.member, { name: name.toUpperCase() });
    expect(await insert('framework', again)).toBe('23505');
    await asMigratorIn(tenant.id, (client) =>
      client.query('UPDATE impact.framework SET archived_at = now() WHERE id = $1', [id]),
    );
    expect(await insert('framework', again)).toBe('ok');
  });

  it('takes a change with its next version and config version, in one transaction', () =>
    asRoleIn('app_api', tenant.id, async (client) => {
      await client.query(
        `UPDATE impact.framework SET name = 'Renamed framework', version = version + 1
          WHERE id = $1`,
        [parts.framework],
      );
      const { rows } = await client.query<{ version: number }>(
        `INSERT INTO app.config_version (tenant_id, entity_type, entity_id, version, author_id, diff)
         SELECT tenant_id, 'impact.framework', id, version, $2, '{"changes": []}'
           FROM impact.framework
          WHERE id = $1
         RETURNING version`,
        [parts.framework, parts.member],
      );
      expect(rows).toEqual([{ version: 2 }]);
    }));

  it('refuses a skipped or kept version, and takes a rise for its outcomes alone', async () => {
    const set = (assignments: string) =>
      asApi(`UPDATE impact.framework SET ${assignments} WHERE id = $1`, [parts.framework]);
    expect(await set("name = 'Renamed framework'")).toBe('23514');
    expect(await set("description = 'More', version = version + 2")).toBe('23514');
    expect(await set('version = version + 2')).toBe('23514');
    expect(await set('version = version - 1')).toBe('23514');
    expect(await set('version = version + 1')).toBe('ok');
    expect(await set(`updated_by = '${parts.member}'`)).toBe('ok');
    expect(await asApi('DELETE FROM impact.framework WHERE id = $1', [parts.framework])).toBe(
      '42501',
    );
  });

  it('refuses padded, blank or over-long text', async () => {
    const row = (change: Record<string, unknown>) =>
      insert('framework', frameworkRow(tenant, parts.member, change));
    expect(await row({ name: ' padded' })).toBe('23514');
    expect(await row({ name: '' })).toBe('23514');
    expect(await row({ name: 'two\nlines' })).toBe('23514');
    expect(await row({ name: 'n'.repeat(201) })).toBe('23514');
    expect(await row({ description: 'd'.repeat(2001) })).toBe('23514');
    expect(await row({ description: 'First paragraph.\n\nSecond paragraph.' })).toBe('ok');
  });
});

describe('an archived framework', { timeout: 60_000 }, () => {
  let archived: ImpactParts & { target: string; result: string; note: string };
  beforeAll(async () => {
    const made = await moreParts();
    archived = await asMigratorIn(tenant.id, async (client) => {
      const rows = {
        target: await insertRow(client, 'impact.target', targetRow(tenant, made)),
        result: await insertRow(client, 'impact.result', resultRow(tenant, made)),
        note: await insertRow(client, 'impact.learning_note', noteRow(tenant, made)),
      };
      await client.query('UPDATE impact.framework SET archived_at = now() WHERE id = $1', [
        made.framework,
      ]);
      return { ...made, ...rows };
    });
  }, 60_000);

  it('stays archived and unchanged', async () => {
    const set = (assignments: string) =>
      asApi(`UPDATE impact.framework SET ${assignments} WHERE id = $1`, [archived.framework]);
    expect(await set('archived_at = NULL')).toBe('55000');
    expect(await set("name = 'Renamed framework', version = version + 1")).toBe('55000');
  });

  it('takes no new outcome, indicator, target, result or note', async () => {
    const { framework, outcome: outcomeId } = archived;
    expect(await insert('outcome', outcomeRow(tenant, framework, { position: 1 }))).toBe('55000');
    expect(
      await insert('indicator', indicatorRow(tenant, framework, outcomeId, { position: 1 })),
    ).toBe('55000');
    expect(
      await insert('target', targetRow(tenant, archived, { programme_id: randomUUID() })),
    ).toBe('55000');
    expect(await insert('result', resultRow(tenant, archived))).toBe('55000');
    expect(await insert('learning_note', noteRow(tenant, archived))).toBe('55000');
  });

  it('keeps what it holds as it is', async () => {
    for (const [statement, id] of [
      ["UPDATE impact.outcome SET name = 'Renamed outcome' WHERE id = $1", archived.outcome],
      ["UPDATE impact.indicator SET name = 'Renamed indicator' WHERE id = $1", archived.indicator],
      ['UPDATE impact.target SET target = 5 WHERE id = $1', archived.target],
      ['DELETE FROM impact.target WHERE id = $1', archived.target],
      ['UPDATE impact.result SET value = 5 WHERE id = $1', archived.result],
      ['DELETE FROM impact.result WHERE id = $1', archived.result],
      ['DELETE FROM impact.learning_note WHERE id = $1', archived.note],
    ] as const) {
      expect(await asApi(statement, [id]), statement).toBe('55000');
    }
  });
});

describe('impact.outcome and impact.indicator', { timeout: 60_000 }, () => {
  it('keep an indicator under an outcome of its own framework', async () => {
    const other = await moreParts();
    expect(await insert('indicator', indicatorRow(tenant, parts.framework, other.outcome))).toBe(
      '23503',
    );
    expect(
      await asApi('UPDATE impact.indicator SET outcome_id = $2 WHERE id = $1', [
        parts.indicator,
        other.outcome,
      ]),
    ).toBe('23503');
    expect(
      await asApi('UPDATE impact.indicator SET framework_id = $2 WHERE id = $1', [
        parts.indicator,
        other.framework,
      ]),
    ).toBe('42501');
  });

  it('refuse a unit, direction, aggregation or position off the lists', async () => {
    const row = (change: Record<string, unknown>) =>
      insert('indicator', indicatorRow(tenant, parts.framework, parts.outcome, change));
    expect(await row({ unit: 'miles' })).toBe('23514');
    expect(await row({ direction: 'sideways' })).toBe('23514');
    expect(await row({ aggregation: 'median' })).toBe('23514');
    expect(await row({ position: 150 })).toBe('23514');
    expect(await row({ position: 149 })).toBe('ok');
    expect(await insert('outcome', outcomeRow(tenant, parts.framework, { position: 50 }))).toBe(
      '23514',
    );
  });

  it('keep an outcome with indicators, and an indicator with figures, in place', async () => {
    const used = await moreParts();
    const remove = (table: string, id: string) =>
      asApi(`DELETE FROM impact.${table} WHERE id = $1`, [id]);
    expect(await remove('outcome', used.outcome)).toBe('23503');
    expect(await remove('indicator', used.indicator)).toBe('ok');
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'impact.result', resultRow(tenant, used)),
    );
    expect(await remove('indicator', used.indicator)).toBe('23503');
  });

  it('fix an indicator`s unit once it has a target or a result', async () => {
    const setUnit = (indicator: string) =>
      asApi("UPDATE impact.indicator SET unit = 'hours' WHERE id = $1", [indicator]);
    const [withTarget, withResult, unused] = [await moreParts(), await moreParts(), parts];
    await asMigratorIn(tenant.id, async (client) => {
      await insertRow(client, 'impact.target', targetRow(tenant, withTarget));
      await insertRow(client, 'impact.result', resultRow(tenant, withResult));
    });
    expect(await setUnit(withTarget.indicator)).toBe('55000');
    expect(await setUnit(withResult.indicator)).toBe('55000');
    expect(await setUnit(unused.indicator)).toBe('ok');
    expect(
      await asApi("UPDATE impact.indicator SET name = 'Renamed indicator' WHERE id = $1", [
        withTarget.indicator,
      ]),
    ).toBe('ok');
  });
});

describe('impact.target', { timeout: 60_000 }, () => {
  it('is one for an indicator, programme and period, with or without a programme', async () => {
    const own = await moreParts();
    const programme = randomUUID();
    await asMigratorIn(tenant.id, async (client) => {
      await insertRow(client, 'impact.target', targetRow(tenant, own));
      await insertRow(client, 'impact.target', targetRow(tenant, own, { programme_id: programme }));
    });
    expect(await insert('target', targetRow(tenant, own))).toBe('23505');
    expect(await insert('target', targetRow(tenant, own, { programme_id: programme }))).toBe(
      '23505',
    );
    expect(await insert('target', targetRow(tenant, own, { programme_id: randomUUID() }))).toBe(
      'ok',
    );
    expect(await insert('target', targetRow(tenant, own, { period_end: '2028-03-31' }))).toBe('ok');
  });

  it('checks its period and figures, and keeps its indicator and period', async () => {
    const own = await moreParts('percentage');
    const row = (change: Record<string, unknown>) =>
      insert('target', targetRow(tenant, own, change));
    expect(await row({ period_end: '2026-03-31' })).toBe('23514');
    expect(await row({ target: -1 })).toBe('23514');
    expect(await row({ target: 100.5 })).toBe('23514');
    expect(await row({ baseline: 101, target: 50 })).toBe('23514');
    expect(await row({ baseline: 12.5, target: 50 })).toBe('ok');
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'impact.target', targetRow(tenant, own)),
    );
    expect(await asApi('UPDATE impact.target SET target = 101 WHERE id = $1', [id])).toBe('23514');
    expect(await asApi('UPDATE impact.target SET baseline = 1 WHERE id = $1', [id])).toBe('ok');
    expect(
      await asApi("UPDATE impact.target SET period_end = '2028-03-31' WHERE id = $1", [id]),
    ).toBe('42501');
    expect(await asApi('DELETE FROM impact.target WHERE id = $1', [id])).toBe('ok');
  });
});

describe('impact.result and its evidence', { timeout: 60_000 }, () => {
  it('checks its figure, note and source', async () => {
    const row = (change: Record<string, unknown>) =>
      insert('result', resultRow(tenant, parts, change));
    expect(await row({ value: 12.5 })).toBe('23514');
    expect(await row({ value: 1_000_000_000_001 })).toBe('23514');
    expect(await row({ note: ' padded' })).toBe('23514');
    expect(await row({ note: 'n'.repeat(2001) })).toBe('23514');
    expect(await row({ note: 'Counted at the door.' })).toBe('ok');
    // The server sets the source of a result it takes from a monitoring report.
    expect(await row({ source: 'monitoring_report' })).toBe('42501');
  });

  it('links a clean file once, and releases it with its row', async () => {
    const own = await moreParts();
    const [result, file, pending] = await asMigratorIn(tenant.id, async (client) => [
      await insertRow(client, 'impact.result', resultRow(tenant, own)),
      await addFile(client, tenant, own.member),
      await addFile(client, tenant, own.member, 'pending'),
    ]);
    expect(await insert('result_evidence', evidenceRow(tenant, own, result, pending))).toBe(
      '55000',
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      /** Whether the file is linked and not yet released. */
      const linked = async () => {
        const { rows } = await client.query<{ linked: boolean }>(
          `SELECT linked_at IS NOT NULL AND released_at IS NULL AS linked
             FROM app.file WHERE id = $1`,
          [file],
        );
        return rows[0]?.linked;
      };
      const evidence = await insertRow(
        client,
        'impact.result_evidence',
        evidenceRow(tenant, own, result, file),
      );
      expect(await linked()).toBe(true);
      const again = evidenceRow(tenant, own, result, file);
      expect(
        await outcome(
          client,
          `INSERT INTO impact.result_evidence (${Object.keys(again).join(', ')})
           VALUES ($1, $2, $3, $4, $5, $6)`,
          Object.values(again),
        ),
      ).not.toBe('ok');
      expect(await outcome(client, 'DELETE FROM impact.result WHERE id = $1', [result])).toBe(
        '23503',
      );
      await client.query(
        "UPDATE impact.result_evidence SET caption = 'New caption' WHERE id = $1",
        [evidence],
      );
      expect(await linked()).toBe(true);
      await client.query('DELETE FROM impact.result_evidence WHERE id = $1', [evidence]);
      expect(await linked()).toBe(false);
      expect(await outcome(client, 'DELETE FROM impact.result WHERE id = $1', [result])).toBe('ok');
    });
  });
});

describe('impact.learning_note', { timeout: 30_000 }, () => {
  it('is for a framework or one of its outcomes, and is added or removed, never edited', async () => {
    const other = await moreParts();
    const row = (change: Record<string, unknown>) =>
      insert('learning_note', noteRow(tenant, parts, change));
    expect(await row({ outcome_id: parts.outcome })).toBe('ok');
    expect(await row({ outcome_id: other.outcome })).toBe('23503');
    expect(await row({ body: '' })).toBe('23514');
    expect(await row({ body: 'b'.repeat(5001) })).toBe('23514');
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'impact.learning_note', noteRow(tenant, parts)),
    );
    expect(await asApi("UPDATE impact.learning_note SET body = 'Edited' WHERE id = $1", [id])).toBe(
      '42501',
    );
    expect(await asApi('DELETE FROM impact.learning_note WHERE id = $1', [id])).toBe('ok');
  });
});
