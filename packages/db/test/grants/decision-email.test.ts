// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.decision_email (migration 0013, ADR 0020): isolation, one email
// per decision, written only for a released decision to its applicant
// from its programme's template for its outcome, and the attempts the
// database counts until the email is sent, after which it never changes.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addPerson } from '../party/fixtures.ts';
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
  addReleased,
  addSubmission,
  decisionRow,
  emailRow,
  type Released,
} from './decision-fixtures.ts';
import { templateRow } from './fixtures.ts';

/** A tenant's released award, one in another programme, and another tenant's. */
let tenant: TestTenant;
let released: Released;
let otherProgramme: Released;
let strangers: Released;
/** In the tenant: an unreleased decision, a person who did not apply and a decline template. */
let unreleased: string;
let bystander: string;
let declineTemplate: string;
beforeAll(async () => {
  tenant = await createTestTenant();
  const other = await createTestTenant();
  released = await asMigratorIn(tenant.id, (client) => addReleased(client, tenant));
  otherProgramme = await asMigratorIn(tenant.id, (client) => addReleased(client, tenant));
  strangers = await asMigratorIn(other.id, (client) => addReleased(client, other));
  [unreleased, bystander, declineTemplate] = await asMigratorIn(tenant.id, async (client) => [
    await insertRow(
      client,
      'grants.decision',
      decisionRow(tenant, await addSubmission(client, tenant)),
    ),
    await addPerson(client, tenant),
    await insertRow(
      client,
      'grants.email_template_version',
      templateRow(tenant, released.programme, { outcome: 'declined', body: 'Dear applicant,' }),
    ),
  ]);
}, 60_000);

describe('grants.decision_email', { timeout: 30_000 }, () => {
  it("keeps each tenant's decision emails from every other tenant", async () => {
    // As migrator, a failed email, which app_api may mark again; app_api
    // itself never writes a status.
    await expectCrossTenantDenial('grants.decision_email', async (client, owner) =>
      emailRow(owner, await addReleased(client, owner), {
        status: 'failed',
        error_code: 'timeout',
        attempts: 1,
        last_attempt_at: new Date(),
      }),
    );
  });

  it.each([
    ['writes a pending email for a released decision', {}, 'ok'],
    ["refuses another tenant's decision", { decision_id: '<strangers decision>' }, '23503'],
    ["refuses another tenant's person", { recipient_person_id: '<stranger>' }, '23503'],
    [
      "refuses another tenant's template version",
      { template_version_id: '<strangers template>' },
      '23503',
    ],
    ['refuses an unreleased decision', { decision_id: '<unreleased>' }, '55000'],
    ['refuses a person who is not the applicant', { recipient_person_id: '<bystander>' }, '55000'],
    ['refuses a template for another outcome', { template_version_id: '<decline>' }, '55000'],
    ["refuses another programme's template", { template_version_id: '<other programme>' }, '55000'],
    ['refuses a status from the caller', { status: 'sent' }, '42501'],
    ['refuses a send time from the caller', { sent_at: '2000-01-01' }, '42501'],
    ['refuses a count of attempts from the caller', { attempts: 1 }, '42501'],
  ])('%s', async (_, change: Row, expected) => {
    const ids: Readonly<Record<string, string>> = {
      '<strangers decision>': strangers.decision,
      '<stranger>': strangers.parts.person,
      '<strangers template>': strangers.template,
      '<unreleased>': unreleased,
      '<bystander>': bystander,
      '<decline>': declineTemplate,
      '<other programme>': otherProgramme.template,
    };
    const values = Object.fromEntries(
      Object.entries(change).map(([column, value]) => [
        column,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      const row = emailRow(tenant, released, values);
      const statement = insertStatement(client, 'grants.decision_email', row);
      expect(await outcome(client, statement.text, statement.values)).toBe(expected);
    });
  });

  it('writes one email per decision', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await insertRow(client, 'grants.decision_email', emailRow(tenant, released));
      const again = insertStatement(client, 'grants.decision_email', emailRow(tenant, released));
      expect(await outcome(client, again.text, again.values)).toBe('23505');
    });
  });

  it('counts each attempt until the email is sent, then never changes it', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const id = await insertRow(client, 'grants.decision_email', emailRow(tenant, released));
      const update = (set: string) => `UPDATE grants.decision_email SET ${set} WHERE id = $1`;
      const refused = (set: string) => outcome(client, update(set), [id]);
      const mark = (set: string) => client.query(update(set), [id]);
      const state = async () =>
        (
          await client.query(
            `SELECT status, error_code, attempts, last_attempt_at = now() AS attempted,
                    sent_at = now() AS sent
               FROM grants.decision_email WHERE id = $1`,
            [id],
          )
        ).rows[0] as unknown;

      expect(await state()).toEqual({
        status: 'pending',
        error_code: null,
        attempts: 0,
        attempted: null,
        sent: null,
      });
      expect(await refused('updated_by = updated_by')).toBe('55000');
      expect(await refused("status = 'failed'")).toBe('23514');
      expect(await refused("status = 'failed', error_code = 'no_reason'")).toBe('23514');
      expect(await refused("status = 'sent', error_code = 'timeout'")).toBe('23514');
      for (const column of ['attempts', 'last_attempt_at', 'sent_at', 'decision_id']) {
        expect(await refused(`${column} = ${column}`), column).toBe('42501');
      }

      await mark("status = 'failed', error_code = 'timeout'");
      await mark("status = 'failed', error_code = 'connection_failed'");
      expect(await state()).toEqual({
        status: 'failed',
        error_code: 'connection_failed',
        attempts: 2,
        attempted: true,
        sent: null,
      });
      expect(await refused("status = 'pending', error_code = NULL")).toBe('55000');

      await mark("status = 'sent', error_code = NULL");
      expect(await state()).toEqual({
        status: 'sent',
        error_code: null,
        attempts: 3,
        attempted: true,
        sent: true,
      });
      expect(await refused("status = 'sent'")).toBe('55000');
      expect(await refused("status = 'failed', error_code = 'timeout'")).toBe('55000');
      const remove = 'DELETE FROM grants.decision_email WHERE id = $1';
      expect(await outcome(client, remove, [id])).toBe('42501');
    });
  });
});
