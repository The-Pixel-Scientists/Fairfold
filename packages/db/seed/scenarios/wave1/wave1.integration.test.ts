// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wave1 scenario, on top of configured, against the test database,
// under slugs no earlier run has used. Each tenant has on exactly the tools
// it lists, each switch with its configuration version and audit event.
// Every row it writes sits in its own tenant, out of sight and out of reach
// of the others' app_api; the monitoring answers count up to the designed cells and appear nowhere else;
// the merge, lists, segment and screening runs are as designed, with no
// decision; and what it prints is row counts only.

import { createHash, randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../../../test/connect.ts';
import { asRoleIn } from '../../../test/tenants.ts';
import { configured } from '../../configured.ts';
import type { SeededTenant, Tenant } from '../../scenario.ts';
import { countLines, writeWave1 } from './index.ts';
import { screeningCases } from './parts/assure.ts';
import { mergeBasisText } from './parts/crm.ts';
import { designedCells, monitoringForm } from './parts/monitoring.ts';
import { wave1Tenants } from './tenants.ts';

const PASSWORD = 'a long synthetic passphrase';
const MONITORING_FIELDS = monitoringForm.sections.flatMap((s) => s.fields.map((f) => f.id));

let seeded: SeededTenant[];
let linnetford: SeededTenant;
let crowmere: SeededTenant;
let sedgebrook: SeededTenant;

beforeAll(async () => {
  const suffix = randomBytes(4).toString('hex');
  const unused = <T extends Tenant>(tenant: T): T => ({
    ...tenant,
    slug: `${tenant.slug}-${suffix}`,
  });
  seeded = await withClient('migrator', (client) =>
    writeWave1(client, PASSWORD, configured.map(unused), wave1Tenants.map(unused)),
  );
  [linnetford, crowmere, sedgebrook] = seeded.slice(configured.length) as [
    SeededTenant,
    SeededTenant,
    SeededTenant,
  ];
}, 300_000);

const count = (tenant: SeededTenant, table: string) => tenant.rows[table]?.length ?? 0;

describe('the wave1 scenario', { timeout: 60_000 }, () => {
  it("writes each tool's rows only for the tenants that have the tool", () => {
    const tables = (tenant: SeededTenant) =>
      Object.keys(tenant.rows).filter(
        (table) => /^(crm|assure)\./.test(table) || table === 'grants.monitoring_response',
      );
    expect(count(linnetford, 'grants.monitoring_response')).toBe(65);
    expect(count(linnetford, 'assure.screening_run')).toBe(screeningCases.length);
    expect(count(sedgebrook, 'assure.screening_run')).toBe(screeningCases.length);
    for (const tenant of [linnetford, sedgebrook]) {
      expect(count(tenant, 'crm.list')).toBe(2);
      expect(count(tenant, 'crm.segment')).toBe(1);
      expect(count(tenant, 'crm.merge_record')).toBe(1);
    }
    expect(tables(crowmere)).toEqual([]);
    expect(tables(sedgebrook)).not.toContain('grants.monitoring_response');
  });

  it('switches on exactly the tools each tenant lists, each switch versioned and audited', async () => {
    const tenants = [linnetford, crowmere, sedgebrook];
    for (const [index, tenant] of tenants.entries()) {
      const tools = [...(wave1Tenants[index]?.tools ?? [])].sort();
      const found = await asRoleIn('app_api', tenant.id, async (client) => {
        const { rows } = await client.query<{
          module: string;
          versioned: boolean;
          audited: boolean;
        }>(
          `SELECT t.module,
                  EXISTS (SELECT 1 FROM app.config_version v
                           WHERE v.entity_type = 'platform.module' AND v.entity_id = t.id
                             AND v.version = 1 AND v.author_kind = 'operator') AS versioned,
                  EXISTS (SELECT 1 FROM app.audit_event a
                           WHERE a.action = 'platform.module.switched_on' AND a.entity_id = t.id
                             AND a.actor_kind = 'operator') AS audited
             FROM app.tenant_module t WHERE t.enabled ORDER BY t.module`,
        );
        return rows;
      });
      expect(
        found.map(({ module }) => module),
        tenant.slug,
      ).toEqual(tools);
      for (const row of found)
        expect(row, tenant.slug).toMatchObject({ versioned: true, audited: true });
    }
  });

  it("keeps every row in its own tenant, out of the others' sight and reach", async () => {
    const tables = [...new Set(seeded.flatMap((tenant) => Object.keys(tenant.rows)))].filter(
      (table) => !table.startsWith('auth.'),
    );
    for (const tenant of seeded) {
      const others = seeded.filter((other) => other !== tenant);
      await asRoleIn('app_api', tenant.id, async (client) => {
        for (const table of tables) {
          const own = tenant.rows[table] ?? [];
          const theirs = others.flatMap((other) => other.rows[table] ?? []);
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`,
            [[...own, ...theirs]],
          );
          expect(rows.map(({ id }) => id).sort(), table).toEqual([...own].sort());
        }
        for (const table of ['grants.monitoring_response', 'crm.list_member']) {
          const theirs = others.flatMap((other) => other.rows[table] ?? []);
          const removed = await client.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [
            theirs,
          ]);
          expect(removed.rowCount, table).toBe(0);
        }
        const changed = await client.query(
          'UPDATE crm.list SET name = name WHERE id = ANY($1::uuid[])',
          [others.flatMap((other) => other.rows['crm.list'] ?? [])],
        );
        expect(changed.rowCount).toBe(0);
      });
    }
  });

  it('gives the designed monitoring counts, and copies no answer anywhere else', async () => {
    await asRoleIn('app_api', linnetford.id, async (client) => {
      const { rows } = await client.query<{
        round: string;
        field: string;
        option: string;
        n: number;
      }>(
        `SELECT r.title AS round, a.key AS field, a.value AS option, count(*)::int AS n
           FROM grants.monitoring_response m
           JOIN grants.round r ON r.id = m.round_id
           CROSS JOIN LATERAL jsonb_each_text(m.answers) AS a
          GROUP BY 1, 2, 3`,
      );
      for (const [round, { cells }] of Object.entries(designedCells)) {
        for (const [field, options] of Object.entries(cells)) {
          for (const [option, expected] of options) {
            const found = rows.find(
              (row) => row.round === round && row.field === field && row.option === option,
            );
            expect(found?.n ?? 0, `${round} ${field} ${option}`).toBe(expected);
          }
        }
      }
      const pattern = MONITORING_FIELDS.join('|');
      const copies = await client.query<{ n: number }>(
        `SELECT ((SELECT count(*) FROM grants.application WHERE answers::text ~ $1)
              + (SELECT count(*) FROM crm.list WHERE concat(name, description) ~ $1)
              + (SELECT count(*) FROM crm.segment WHERE definition::text ~ $1))::int AS n`,
        [pattern],
      );
      expect(copies.rows[0]?.n).toBe(0);
    });
    const audited = await asRoleIn('app_api', linnetford.id, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM app.audit_event WHERE changes::text ~ $1',
        [MONITORING_FIELDS.join('|')],
      );
      return rows[0]?.n;
    });
    expect(audited).toBe(0);
  });

  it('merges one pair as the merge would, and leaves the look-alikes apart', async () => {
    await asRoleIn('app_api', linnetford.id, async (client) => {
      const { rows } = await client.query<{
        loser_id: string;
        survivor_id: string;
        preview_hash: string;
        status: string;
        merged_into: string;
      }>(
        `SELECT r.loser_id, r.survivor_id, r.preview_hash, p.status, p.merged_into
           FROM crm.merge_record r JOIN party.party p ON p.id = r.loser_id`,
      );
      const [merge] = rows;
      expect(rows).toHaveLength(1);
      expect(merge?.status).toBe('merged');
      expect(merge?.merged_into).toBe(merge?.survivor_id);
      const text = mergeBasisText(merge?.loser_id ?? '', merge?.survivor_id ?? '');
      expect(merge?.preview_hash).toBe(createHash('sha256').update(text).digest('hex'));
      const merged = await client.query("SELECT 1 FROM party.party WHERE status = 'merged'");
      expect(merged.rowCount).toBe(1);
    });
  });

  it('leaves every screening run queued or without a list, with no match or decision', async () => {
    for (const tenant of [linnetford, sedgebrook]) {
      await asRoleIn('app_api', tenant.id, async (client) => {
        const runs = await client.query<{ status: string; roles: string[] }>(
          `SELECT r.status, m.roles FROM assure.screening_run r
             JOIN app.membership m ON m.id = r.requested_by ORDER BY r.status`,
        );
        expect(runs.rows.map(({ status }) => status)).toEqual([
          ...Array<string>(screeningCases.length - 2).fill('no_list'),
          'queued',
          'queued',
        ]);
        for (const { roles } of runs.rows) expect(roles).toEqual(['due_diligence_officer']);
        const decided = await client.query(
          'SELECT 1 FROM assure.screening_match UNION ALL SELECT 1 FROM assure.match_decision',
        );
        expect(decided.rowCount).toBe(0);
      });
    }
  });

  it('prints row counts by table and nothing else', () => {
    const lines = countLines(seeded);
    expect(lines[0]).toBe('');
    for (const line of lines.slice(1)) expect(line).toMatch(/^ {2}[a-z_]+\.[a-z_]+: [0-9]+$/);
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });
});
