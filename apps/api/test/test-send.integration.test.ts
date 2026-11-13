// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The email template test send through the whole API against the test
// database, as app_api, for two tenants: the email goes only to the signed-in
// member, is filled with made-up values, carries a test marker, is limited
// per member, and leaves nothing but an audit event of the template version.

import { randomUUID } from 'node:crypto';

import { TEST_SENDS_PER_HOUR } from '@pixel-scientists/grants/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startMessagesApi, type MessagesApi } from './messages-api.ts';
import { switchModule } from './modules-on.ts';
import { type Problem } from './programme-api.ts';
import { addMember, type Member } from './settings-api.ts';
import { expectLooksMissing } from './support.ts';

vi.setConfig({ testTimeout: 30_000 });

let t: MessagesApi;
let accepted: string;

beforeAll(async () => {
  t = await startMessagesApi('41132');
  await t.submitted();
  const [row] = await t.rows<{ id: string }>(
    "SELECT id FROM grants.email_template_version WHERE outcome = 'accepted' LIMIT 1",
  );
  accepted = row?.id ?? '';
}, 60_000);

afterAll(async () => {
  await t.close();
});

const PATH = '/console/email-templates/test-sends';
const sendTest = (body: object, member: Member = t.managerA, key?: string) =>
  t.send(member, 'POST', PATH, body, 'console', null, key);
const events = (id: string) =>
  t.eventsOf<{ actor_id: string; changes: object }>('grants.email_template.test_sent', id);

describe('sending a test email', () => {
  it('goes to the signed-in member, marked as a test, filled with made-up values', async () => {
    t.sent.length = 0;
    expect((await sendTest({ templateVersionId: accepted })).statusCode).toBe(202);

    expect(t.sent).toHaveLength(1);
    const [email] = t.sent;
    expect(email?.to).toBe('jo@example.org');
    expect(email?.subject).toMatch(/^Test email: /);
    expect(`${email?.subject}\n${email?.text}`).not.toMatch(/\{\{/);
    expect(email?.text).toContain('Sam');
    for (const real of ['Northfield', 'Ada', 'Applicant-Secret', t.ann.userId]) {
      expect(`${email?.subject}\n${email?.text}`).not.toContain(real);
    }
    const [event] = await events(accepted);
    expect(event).toMatchObject({ actor_id: t.managerA.membershipId, changes: {} });
    expect(JSON.stringify(event)).not.toMatch(/jo@example|Example/);
  });

  it('refuses any field that names a recipient, and sends nothing', async () => {
    t.sent.length = 0;
    for (const field of ['to', 'email', 'cc', 'bcc', 'recipient']) {
      const response = await sendTest({ templateVersionId: accepted, [field]: 'x@example.org' });
      expect(response.statusCode, field).toBe(400);
      expect(response.body).not.toContain('x@example.org');
    }
    expect((await sendTest({})).statusCode).toBe(400);
    expect((await sendTest({ templateVersionId: 'not-an-id' })).statusCode).toBe(400);
    expect(t.sent).toHaveLength(0);
  });

  it('sends once for one idempotency key', async () => {
    t.sent.length = 0;
    const key = randomUUID();
    expect((await sendTest({ templateVersionId: accepted }, t.ada, key)).statusCode).toBe(202);
    expect((await sendTest({ templateVersionId: accepted }, t.ada, key)).statusCode).toBe(202);

    expect(t.sent).toHaveLength(1);
  });

  it('answers a delivery failure with its code only, and keeps no event of it', async () => {
    const member = await addMember(t.tenantA, 'console', 'programme_manager');
    t.sendWith(() => Promise.resolve({ sent: false, code: 'connection_failed' }));
    try {
      const response = await sendTest({ templateVersionId: accepted }, member);
      expect(response.statusCode).toBe(409);
      expect(response.json<Problem>().errors).toEqual([
        { field: 'delivery', message: 'connection_failed' },
      ]);
      expect(response.body).not.toMatch(/jo@example|smtp/i);
    } finally {
      t.restore();
    }
    const counted = await t.rows<{ n: string }>(
      `SELECT count(*) AS n FROM app.audit_event
        WHERE action = 'grants.email_template.test_sent' AND actor_id = $1`,
      [member.membershipId],
    );
    expect(counted).toEqual([{ n: '0' }]);
  });

  it('limits each member per hour, with Retry-After, and counts members separately', async () => {
    const member = await addMember(t.tenantA, 'console', 'programme_manager');
    t.sent.length = 0;
    for (let sent = 0; sent < TEST_SENDS_PER_HOUR; sent++) {
      expect((await sendTest({ templateVersionId: accepted }, member)).statusCode).toBe(202);
    }

    const refused = await sendTest({ templateVersionId: accepted }, member);
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.sent).toHaveLength(TEST_SENDS_PER_HOUR);
    expect((await sendTest({ templateVersionId: accepted }, t.managerA)).statusCode).toBe(202);
  });

  it('refuses members without the permission, and answers another tenant and a module off as missing', async () => {
    t.sent.length = 0;
    for (const member of [t.grace, t.adminA]) {
      expect((await sendTest({ templateVersionId: accepted }, member)).statusCode).toBe(403);
    }
    expect(
      (await t.send(undefined, 'POST', PATH, { templateVersionId: accepted })).statusCode,
    ).toBe(401);
    const asApplicant = await t.send(
      t.ann,
      'POST',
      PATH,
      { templateVersionId: accepted },
      'console',
    );
    expect(asApplicant.statusCode).not.toBe(202);

    expectLooksMissing(
      await sendTest({ templateVersionId: accepted }, t.managerB),
      await sendTest({ templateVersionId: randomUUID() }),
    );
    await switchModule(t.tenantA, 'grants', false);
    try {
      expect((await sendTest({ templateVersionId: accepted })).statusCode).toBe(404);
    } finally {
      await switchModule(t.tenantA, 'grants');
    }
    expect(t.sent).toHaveLength(0);
  });
});
