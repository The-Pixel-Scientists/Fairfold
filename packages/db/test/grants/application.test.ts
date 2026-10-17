// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.application (migration 0011): isolation, the keys to the round's
// own form versions and stages and to the tenant's people and
// organisations, a published form version only, the status checks, one
// live application per organisation and round, the changes each status
// allows, and the submission and withdrawal times the database sets.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addOrganisation } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addParts,
  addPublishedForm,
  applicationRow,
  submit,
  type Parts,
} from './application-fixtures.ts';
import { addRound, addStage } from './fixtures.ts';

/** A tenant with the parts of an application, and another tenant's own. */
let tenant: TestTenant;
let parts: Parts;
let strangers: Parts;
/** Another round of the tenant, with its own stage and published form. */
let otherRound: { id: string; stage: string; formVersion: string };
/** A draft form version of the parts' round. */
let draftForm: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  parts = await asMigratorIn(tenant.id, (client) => addParts(client, tenant));
  strangers = await asMigratorIn(other.id, (client) => addParts(client, other));
  otherRound = await asMigratorIn(tenant.id, async (client) => {
    const round = await addRound(client, tenant);
    return {
      id: round,
      stage: await addStage(client, tenant, round),
      formVersion: await addPublishedForm(client, tenant, round, parts.member),
    };
  });
  draftForm = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'grants.form_version', {
      tenant_id: tenant.id,
      round_id: parts.round,
      version: 2,
      created_by: parts.member,
    }),
  );
}, 60_000);

describe('grants.application', { timeout: 30_000 }, () => {
  it("keeps each tenant's applications from every other tenant", async () => {
    await expectCrossTenantDenial('grants.application', async (client, owner) =>
      applicationRow(owner, await addParts(client, owner)),
    );
  });

  it.each([
    ['refuses a form version of another round', { form_version_id: '<other form>' }, '23503'],
    ['refuses a draft form version', { form_version_id: '<draft form>' }, '55000'],
    ["refuses another tenant's form version", { form_version_id: '<strangers form>' }, '23503'],
    ["refuses another tenant's person", { applicant_person_id: '<strangers person>' }, '23503'],
    [
      "refuses another tenant's organisation",
      { organisation_id: '<strangers organisation>' },
      '23503',
    ],
    ["refuses another tenant's round", { round_id: '<strangers round>' }, '23503'],
    ['refuses a creator from another tenant', { created_by: '<stranger>' }, '23503'],
    ['refuses a person as the organisation', { organisation_id: '<person>' }, '23503'],
    ['refuses a new submitted application', { status: 'submitted' }, '42501'],
    ['refuses answers on a new application', { answers: {} }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<other form>': otherRound.formVersion,
      '<draft form>': draftForm,
      '<strangers form>': strangers.formVersion,
      '<strangers person>': strangers.person,
      '<strangers organisation>': strangers.organisation,
      '<strangers round>': strangers.round,
      '<stranger>': strangers.member,
      '<person>': parts.person,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const statement = insertStatement(
        client,
        'grants.application',
        applicationRow(tenant, parts, values),
      );
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('starts a draft with empty answers at version 1, and fixes what it refers to', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
      const { rows } = await client.query(
        `SELECT status, answers, answers_version, stage_id, submitted_at, submitted_late,
                withdrawn_at FROM grants.application WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          status: 'draft',
          answers: {},
          answers_version: 1,
          stage_id: null,
          submitted_at: null,
          submitted_late: false,
          withdrawn_at: null,
        },
      ]);
      for (const change of [
        'round_id = round_id',
        'form_version_id = form_version_id',
        'applicant_person_id = applicant_person_id',
        'organisation_id = organisation_id',
        'tenant_id = tenant_id',
        'created_at = created_at',
      ]) {
        const update = `UPDATE grants.application SET ${change} WHERE id = $1`;
        expect(await outcome(client, update, [id]), change).toBe('42501');
      }
      expect(await outcome(client, 'DELETE FROM grants.application WHERE id = $1', [id])).toBe(
        '42501',
      );
    });
  });

  it.each([
    ['refuses answers that are not an object', "answers = '[]'", '23514'],
    ['refuses answers version 0', 'answers_version = 0', '23514'],
    ['refuses an unknown status', "status = 'archived'", '23514'],
    ['refuses a draft with a stage', 'stage_id = <stage>', '23514'],
    ['refuses a late draft', 'submitted_late = true', '23514'],
    ['refuses setting the submission time', 'submitted_at = now()', '42501'],
    ['refuses setting the withdrawal time', 'withdrawn_at = now()', '42501'],
    ['refuses submitting without a stage', "status = 'submitted'", '23514'],
    ['refuses a stage of another round', "status = 'submitted', stage_id = <other stage>", '23503'],
    ['refuses withdrawing a draft', "status = 'withdrawn', stage_id = <stage>", '55000'],
    [
      'accepts a late submission',
      "status = 'submitted', stage_id = <stage>, submitted_late = true",
      'ok',
    ],
  ])('%s', async (_, change, expected) => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
      expect(await outcome(client, updateStatement(change), [id])).toBe(expected);
    });
  });

  it.each([
    ['refuses a draft with a submission time', 'submitted_at = now()', '23514'],
    ['refuses a draft with a withdrawal time', 'withdrawn_at = now()', '23514'],
    [
      'refuses withdrawing a draft with a submission time',
      "status = 'withdrawn', submitted_at = now() - interval '30 days', stage_id = <stage>, " +
        'withdrawn_at = now()',
      '55000',
    ],
  ])('%s, even to migrator, which may update every column', async (_, change, expected) => {
    await asRoleIn('migrator', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
      expect(await outcome(client, updateStatement(change), [id])).toBe(expected);
    });
  });

  it('sets the submission and withdrawal times itself, whatever the caller sends', async () => {
    for (const [role, submitted, withdrawn] of [
      ['app_api', '', ''],
      ['migrator', ", submitted_at = '2000-01-01'", ", withdrawn_at = '2000-01-02'"],
    ] as const) {
      await asRoleIn(role, tenant.id, async (client) => {
        const id = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
        const times = async () =>
          (
            await client.query<{ submitted: boolean; withdrawn: boolean | null }>(
              `SELECT submitted_at = now() AS submitted, withdrawn_at = now() AS withdrawn
                 FROM grants.application WHERE id = $1`,
              [id],
            )
          ).rows;
        const submit = updateStatement(`status = 'submitted', stage_id = <stage>${submitted}`);
        await client.query(submit, [id]);
        expect(await times(), role).toEqual([{ submitted: true, withdrawn: null }]);
        await client.query(updateStatement(`status = 'withdrawn'${withdrawn}`), [id]);
        expect(await times(), role).toEqual([{ submitted: true, withdrawn: true }]);
      });
    }
  });

  it('allows one live application per organisation and round, not counting withdrawn ones', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const organisation = await addOrganisation(client, tenant);
      const row = applicationRow(tenant, parts, { organisation_id: organisation });
      const first = await insertRow(client, 'grants.application', row);
      const second = insertStatement(client, 'grants.application', row);
      expect(await outcome(client, second.text, second.values)).toBe('23505');
      await submit(client, first, parts.stages[0]);
      expect(await outcome(client, second.text, second.values)).toBe('23505');

      await client.query("UPDATE grants.application SET status = 'withdrawn' WHERE id = $1", [
        first,
      ]);
      await insertRow(client, 'grants.application', row);
      expect(await outcome(client, second.text, second.values)).toBe('23505');
      const otherRoundRow = applicationRow(tenant, parts, {
        organisation_id: organisation,
        round_id: otherRound.id,
        form_version_id: otherRound.formVersion,
      });
      const inOtherRound = insertStatement(client, 'grants.application', otherRoundRow);
      expect(await outcome(client, inOtherRound.text, inOtherRound.values)).toBe('ok');
    });
  });

  it('changes a draft, then lets a submitted one move stage or be withdrawn, and nothing more', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.application', applicationRow(tenant, parts));
      const update = (set: string) =>
        outcome(client, `UPDATE grants.application SET ${set} WHERE id = $1`, [id]);

      expect(await update(`answers = '{"f_name": "Hall roof"}', answers_version = 2`)).toBe('ok');
      expect(await submit(client, id, parts.stages[0])).toMatchObject({ rowCount: 1 });

      const frozen = [
        `answers = '{"f_name": "Hall floor"}'`,
        'answers_version = 3',
        'submitted_late = true',
        "status = 'draft', stage_id = NULL",
      ];
      for (const set of frozen) expect(await update(set), set).toBe('55000');
      const moved = await client.query(
        'UPDATE grants.application SET stage_id = $2 WHERE id = $1',
        [id, parts.stages[1]],
      );
      expect(moved.rowCount).toBe(1);
      await client.query("UPDATE grants.application SET status = 'withdrawn' WHERE id = $1", [id]);
      for (const set of [`stage_id = '${parts.stages[0]}'`, 'updated_by = updated_by']) {
        expect(await update(set), set).toBe('55000');
      }
    });
  });
});

/** An update of application `$1`, with <stage> and <other stage> filled in. */
function updateStatement(change: string): string {
  const set = change
    .replace('<stage>', `'${parts.stages[0]}'`)
    .replace('<other stage>', `'${otherRound.stage}'`);
  return `UPDATE grants.application SET ${set} WHERE id = $1`;
}
