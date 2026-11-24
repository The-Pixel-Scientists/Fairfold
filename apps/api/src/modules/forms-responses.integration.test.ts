// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms response routes through the whole API against the test database,
// as app_api: sessions, the policy, row-level security, the idempotency keys
// and the audit log, for two tenants. The anonymous routes are tested where
// the database has `forms.public_form()`, which the migrations do not create
// yet; until then those tests skip, and the response lookup is tested through
// the function that does exist.

import { randomBytes, randomUUID } from 'node:crypto';

import { tokenHash } from '@pixel-scientists/forms/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { submit } from '../../../../packages/db/test/forms/fixtures.ts';
import { asMigratorIn, createTestTenant } from '../../../../packages/db/test/tenants.ts';
import { solve } from '../../../../modules/forms/src/server/public/testing.ts';
import { switchModule } from '../../test/modules-on.ts';
import {
  answer,
  rowsOf,
  startProgrammeApi,
  type Method,
  type Problem,
  type ProgrammeApi,
} from '../../test/programme-api.ts';
import { addMember, events, type Member } from '../../test/settings-api.ts';
import { expectLooksMissing } from '../../test/support.ts';
import { Secret } from '../config.ts';
import { ApiError } from '../problems.ts';
import { formsPublicDependencies } from './forms-public.ts';
import type { ModuleDatabase } from './types.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

interface Form {
  id: string;
}
interface Version {
  id: string;
}
interface Portal {
  id: string;
  formVersionId: string;
}
interface Draft {
  formVersionId: string | null;
  answers: Record<string, unknown>;
  updatedAt: string | null;
}
interface Receipt {
  responseId: string;
  confirmationMessage: string;
}
interface Summary {
  id: string;
  route: string;
  personId: string | null;
  sentWithoutCheck: boolean;
  spamReason: string | null;
}
interface Response extends Summary {
  answers: Record<string, unknown>;
  definition: unknown;
}
interface Page {
  responses: Summary[];
  nextCursor: string | null;
}
interface Totals {
  received: number;
  signedIn: number;
  anonymous: number;
  sentWithoutCheck: number;
  spam: number;
}

const FORMS = '/console/forms';
const PORTAL = '/portal/forms';
const KEY = (letter: string) => new Secret(letter.repeat(32));
const HASH_KEY = Buffer.from(KEY('b').reveal(), 'utf8');
/** A reference as the browser makes one. A token's hash is unique across the database, so each use needs its own. */
const newToken = (): string => randomBytes(32).toString('base64url');

const definition = {
  sections: [
    {
      id: 's_one',
      title: 'Your feedback',
      fields: [
        {
          id: 'f_rating',
          type: 'short_text',
          label: 'Rating',
          required: true,
          classification: 'internal',
        },
        { id: 'f_note', type: 'long_text', label: 'Note', classification: 'personal' },
        {
          id: 'f_count',
          type: 'short_text',
          label: 'Counted only',
          audiences: 'aggregate_only',
          classification: 'special_category',
        },
      ],
    },
  ],
};

const anonymousDefinition = {
  sections: [
    {
      ...definition.sections[0],
      fields: definition.sections[0]?.fields.filter((field) => field.id !== 'f_count'),
    },
  ],
};

let t: ProgrammeApi;
let applicantA: Member;
let otherApplicantA: Member;
let applicantB: Member;
let publicFormExists = false;
let pool: ModuleDatabase;

beforeAll(async () => {
  t = await startProgrammeApi('41391', undefined, undefined, (database) => ({
    database: (pool = database),
    settings: {
      crm: undefined,
      marketing: undefined,
      assure: { registryKeys: {}, sanctionsListUrl: undefined },
      forms: { proofKey: KEY('a'), hashKey: KEY('b'), difficulty: 8, noProof: true },
    },
  }));
  await switchModule(t.tenantA, 'forms');
  await switchModule(t.tenantB, 'forms');
  applicantA = await addMember(t.tenantA, 'portal', 'applicant');
  otherApplicantA = await addMember(t.tenantA, 'portal', 'applicant');
  applicantB = await addMember(t.tenantB, 'portal', 'applicant');
  const [probe] = await asMigratorIn(
    t.tenantA.id,
    async (client) =>
      (
        await client.query<{ found: boolean }>(
          `SELECT to_regproc('forms.public_form') IS NOT NULL AS found`,
        )
      ).rows,
  );
  publicFormExists = probe?.found ?? false;
}, 60_000);

afterAll(async () => {
  await t.close();
});

const send = (member: Member | undefined, method: Method, url: string, body?: unknown) =>
  t.send(member, method, url, body);

/** A published form of tenant A whose questions are the definition above. */
async function aForm(
  change: { respondents?: string; closesAt?: string } = {},
  who: Member = t.managerA,
) {
  // A form anyone can answer has no question only counted in reports.
  const questions = change.respondents === 'anonymous' ? anonymousDefinition : definition;
  const form = await answer<Form>(
    send(who, 'POST', FORMS, {
      title: 'Event feedback',
      description: 'What people thought.',
      respondents: 'signed_in',
      opensAt: null,
      closesAt: null,
      confirmationMessage: 'Thank you for telling us.',
      ...change,
    }),
    201,
  );
  await answer(send(who, 'PUT', `${FORMS}/${form.id}/draft`, { definition: questions }));
  const version = await answer<Version>(send(who, 'POST', `${FORMS}/${form.id}/versions`), 201);
  return { form, version };
}

const answers = (change: object = {}) => ({ f_rating: 'good', f_note: 'It was fine.', ...change });

/** Answers a form as `who`: its pinned version and the answers. */
const sent = (versionId: string, change: object = {}) => ({
  formVersionId: versionId,
  answers: answers(change),
});

const submitAs = (who: Member, formId: string, body: unknown, key: string = randomUUID()) =>
  t.send(who, 'POST', `${PORTAL}/${formId}/responses`, body, who.app, null, key);

const counts = () =>
  rowsOf<{ responses: number; events: number; people: number }>(
    t.tenantA,
    `SELECT (SELECT count(*) FROM forms.response)::int AS responses,
            (SELECT count(*) FROM app.audit_event WHERE action LIKE 'forms.%')::int AS events,
            (SELECT count(*) FROM party.person)::int AS people`,
  );

describe('who may use the response routes', () => {
  it('refuse everyone but a programme manager on the console routes, a signed-in respondent on the portal routes, and a signed-out caller on both', async () => {
    const { form, version } = await aForm();
    const receipt = await answer<Receipt>(submitAs(applicantA, form.id, sent(version.id)), 201);
    const before = await counts();
    const response = receipt.responseId;

    const consoleRoutes: [Method, string, unknown][] = [
      ['GET', `${FORMS}/${form.id}/responses`, undefined],
      ['GET', `${FORMS}/${form.id}/response-totals`, undefined],
      ['GET', `/console/form-responses/${response}`, undefined],
      ['POST', '/console/form-responses/lookup', { reference: newToken() }],
      ['POST', `/console/form-responses/${response}/spam`, { reason: 'test' }],
      ['POST', `/console/form-responses/${response}/not-spam`, undefined],
    ];
    for (const [method, url, body] of consoleRoutes) {
      for (const [who, member] of [
        ['a reviewer', t.reviewerA],
        ['an administrator', t.adminA],
        ['an applicant', applicantA],
      ] as const) {
        const denied = await send(member, method, url, body);
        expect(denied.statusCode, `${method} ${url} as ${who}`).toBe(403);
      }
      expect(
        (await send(undefined, method, url, body)).statusCode,
        `${method} ${url} signed out`,
      ).toBe(401);
    }

    const portalRoutes: [Method, string, unknown][] = [
      ['GET', `${PORTAL}/${form.id}`, undefined],
      ['GET', `${PORTAL}/${form.id}/draft`, undefined],
      ['PUT', `${PORTAL}/${form.id}/draft`, sent(version.id)],
      ['POST', `${PORTAL}/${form.id}/responses`, sent(version.id)],
      ['GET', '/portal/form-responses', undefined],
      ['GET', `/portal/form-responses/${response}`, undefined],
    ];
    for (const [method, url, body] of portalRoutes) {
      for (const [who, member] of [
        ['a programme manager', t.managerA],
        ['a reviewer', t.reviewerA],
      ] as const) {
        const denied = await t.send(member, method, url, body, 'portal');
        expect(denied.statusCode, `${method} ${url} as ${who}`).toBe(403);
      }
      const inConsole = await t.send(applicantA, method, url, body, 'console');
      expect(inConsole.statusCode, `${method} ${url} in the console`).toBe(403);
      expect(
        (await send(undefined, method, url, body)).statusCode,
        `${method} ${url} signed out`,
      ).toBe(401);
    }
    expect(await counts()).toEqual(before);
  });

  it('answer 404 on every route while forms is off', async () => {
    const off = await createTestTenant();
    const owner = await addMember(off, 'console', 'programme_manager');
    const person = await addMember(off, 'portal', 'applicant');
    for (const [method, url, body] of [
      ['GET', `${FORMS}/${randomUUID()}/responses`, undefined],
      ['GET', `/console/form-responses/${randomUUID()}`, undefined],
    ] as const) {
      expect((await send(owner, method, url, body)).statusCode, url).toBe(404);
    }
    expect((await send(person, 'GET', `${PORTAL}/${randomUUID()}`)).statusCode).toBe(404);
    expect((await send(person, 'GET', '/portal/form-responses')).statusCode).toBe(404);
  });
});

describe('a signed-in respondent', () => {
  it('saves a draft, moves on to submit, and gets a receipt that a replay repeats', async () => {
    const { form, version } = await aForm();
    const url = `${PORTAL}/${form.id}`;

    const open = await answer<Portal>(send(applicantA, 'GET', url));
    expect(open).toMatchObject({ id: form.id, formVersionId: version.id });
    expect(await answer<Draft>(send(applicantA, 'GET', `${url}/draft`))).toEqual({
      formVersionId: null,
      answers: {},
      updatedAt: null,
    });

    const first = await answer<Draft>(
      send(applicantA, 'PUT', `${url}/draft`, {
        formVersionId: version.id,
        answers: { f_note: 'Half' },
      }),
    );
    expect(first).toMatchObject({ formVersionId: version.id, answers: { f_note: 'Half' } });
    const second = await answer<Draft>(
      send(applicantA, 'PUT', `${url}/draft`, sent(version.id, { f_note: 'Whole' })),
    );
    expect(second.answers).toEqual({ f_rating: 'good', f_note: 'Whole' });
    expect(
      await rowsOf(t.tenantA, `SELECT status FROM forms.response WHERE form_id = $1`, [form.id]),
    ).toEqual([{ status: 'draft' }]);

    const key = randomUUID();
    const body = sent(version.id, { f_note: 'Whole' });
    const receipt = await answer<Receipt>(submitAs(applicantA, form.id, body, key), 201);
    expect(receipt.confirmationMessage).toBe('Thank you for telling us.');
    const replay = await answer<Receipt>(submitAs(applicantA, form.id, body, key), 201);
    expect(replay.responseId).toBe(receipt.responseId);

    const stored = await rowsOf<{ status: string; route: string; retained: boolean }>(
      t.tenantA,
      `SELECT status, route, retain_until IS NOT NULL AS retained FROM forms.response WHERE form_id = $1`,
      [form.id],
    );
    expect(stored).toEqual([{ status: 'submitted', route: 'signed_in', retained: true }]);
    expect(await answer<Draft>(send(applicantA, 'GET', `${url}/draft`))).toMatchObject({
      formVersionId: null,
    });
  });

  it('audits a submission with the person as its subject and no answer, and a draft with nothing', async () => {
    const { form, version } = await aForm();
    await answer(send(applicantA, 'PUT', `${PORTAL}/${form.id}/draft`, sent(version.id)));
    const receipt = await answer<Receipt>(
      submitAs(applicantA, form.id, sent(version.id, { f_note: 'Very private' })),
      201,
    );

    const [event] = (await events(t.tenantA, 'forms.response.submitted')).filter(
      (row) => row.entity_id === receipt.responseId,
    );
    expect(event?.changes).toEqual({
      'forms.response.form_id': { after: form.id },
      'forms.response.form_version_id': { after: version.id },
    });
    const [row] = await rowsOf<{ subject_party_id: string; person: string }>(
      t.tenantA,
      `SELECT e.subject_party_id, r.respondent_person_id AS person
         FROM app.audit_event e JOIN forms.response r ON r.id = e.entity_id
        WHERE e.action = 'forms.response.submitted' AND e.entity_id = $1`,
      [receipt.responseId],
    );
    expect(row?.subject_party_id).toBe(row?.person);
    expect(
      JSON.stringify(await rowsOf(t.tenantA, `SELECT changes FROM app.audit_event`)),
    ).not.toContain('Very private');
    const draftEvents = await rowsOf(
      t.tenantA,
      `SELECT 1 FROM app.audit_event WHERE action LIKE 'forms.%draft%' AND entity_id = $1`,
      [form.id],
    );
    expect(draftEvents).toEqual([]);
  });

  it('is told what to fix by field id, and that the form changed for a version it does not take', async () => {
    const { form, version } = await aForm();
    const url = `${PORTAL}/${form.id}/responses`;

    const missing = await submitAs(applicantA, form.id, {
      formVersionId: version.id,
      answers: { f_note: 'No rating' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<Problem>().errors?.map((error) => error.field)).toEqual(['f_rating']);

    const unknown = await submitAs(applicantA, form.id, {
      formVersionId: version.id,
      answers: answers({ f_other: 'x' }),
    });
    expect(unknown.statusCode).toBe(400);

    const changed = await submitAs(applicantA, form.id, sent(randomUUID()));
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ type: string }>().type).toBe('/problems/form-changed');
    expect(
      (await t.send(applicantA, 'POST', url, { ...sent(version.id), extra: true })).statusCode,
    ).toBe(400);
  });

  it('reaches forms that take signed-in answers now, and no others', async () => {
    const closed = await aForm({ closesAt: '2020-01-01T00:00:00Z' });
    const anonymous = await aForm({ respondents: 'anonymous' });
    const unpublished = await answer<Form>(
      send(t.managerA, 'POST', FORMS, {
        title: 'Not yet',
        description: '',
        respondents: 'signed_in',
        opensAt: null,
        closesAt: null,
        confirmationMessage: '',
      }),
      201,
    );
    for (const { id, versionId } of [
      { id: closed.form.id, versionId: closed.version.id },
      { id: anonymous.form.id, versionId: anonymous.version.id },
      { id: unpublished.id, versionId: randomUUID() },
    ]) {
      for (const [method, suffix, body] of [
        ['GET', '', undefined],
        ['GET', '/draft', undefined],
        ['PUT', '/draft', sent(versionId)],
        ['POST', '/responses', sent(versionId)],
      ] as const) {
        const response = await send(applicantA, method, `${PORTAL}/${id}${suffix}`, body);
        expect(response.statusCode, `${method} ${suffix} of ${id}`).toBe(404);
      }
    }
  });

  it('lists and reads only their own responses, as a respondent sees them', async () => {
    const { form, version } = await aForm();
    const mine = await answer<Receipt>(
      submitAs(applicantA, form.id, sent(version.id, { f_count: 'Counted' })),
      201,
    );
    await answer<Receipt>(submitAs(otherApplicantA, form.id, sent(version.id)), 201);

    const page = await answer<{ responses: { id: string; formTitle: string }[] }>(
      send(applicantA, 'GET', '/portal/form-responses'),
    );
    expect(page.responses.map((response) => response.id)).toContain(mine.responseId);
    expect(page.responses.every((response) => response.formTitle !== '')).toBe(true);
    const read = await answer<{ answers: Record<string, unknown>; formId: string }>(
      send(applicantA, 'GET', `/portal/form-responses/${mine.responseId}`),
    );
    expect(read.answers).toEqual({ f_rating: 'good', f_note: 'It was fine.', f_count: 'Counted' });
    expect(Object.keys(read)).not.toContain('spamReason');

    const theirs = await send(otherApplicantA, 'GET', `/portal/form-responses/${mine.responseId}`);
    const absent = await send(otherApplicantA, 'GET', `/portal/form-responses/${randomUUID()}`);
    expectLooksMissing(theirs, absent);
    const others = await answer<{ responses: { id: string }[] }>(
      send(otherApplicantA, 'GET', '/portal/form-responses'),
    );
    expect(others.responses.map((response) => response.id)).not.toContain(mine.responseId);
  });

  it('cannot reach another tenant’s form, draft or response', async () => {
    const { form, version } = await aForm();
    const receipt = await answer<Receipt>(submitAs(applicantA, form.id, sent(version.id)), 201);
    const before = await counts();

    for (const [method, url, body] of [
      ['GET', `${PORTAL}/${form.id}`, undefined],
      ['GET', `${PORTAL}/${form.id}/draft`, undefined],
      ['PUT', `${PORTAL}/${form.id}/draft`, sent(version.id)],
      ['POST', `${PORTAL}/${form.id}/responses`, sent(version.id)],
      ['GET', `/portal/form-responses/${receipt.responseId}`, undefined],
    ] as const) {
      const outside = await send(applicantB, method, url, body);
      const missing = await send(
        applicantB,
        method,
        url.replace(form.id, randomUUID()).replace(receipt.responseId, randomUUID()),
        body,
      );
      expectLooksMissing(outside, missing);
    }
    expect(await counts()).toEqual(before);
  });
});

describe('staff reading responses', () => {
  it('list, count and read them with only the answers staff may see, recording each read', async () => {
    const { form, version } = await aForm();
    const receipt = await answer<Receipt>(
      submitAs(applicantA, form.id, sent(version.id, { f_count: 'Counted' })),
      201,
    );

    const page = await answer<Page>(send(t.managerA, 'GET', `${FORMS}/${form.id}/responses`));
    expect(page.responses).toHaveLength(1);
    expect(page.responses[0]).toMatchObject({
      id: receipt.responseId,
      route: 'signed_in',
      sentWithoutCheck: false,
      spamReason: null,
    });
    expect(page.nextCursor).toBeNull();
    expect(
      await answer<Totals>(send(t.managerA, 'GET', `${FORMS}/${form.id}/response-totals`)),
    ).toEqual({
      received: 1,
      signedIn: 1,
      anonymous: 0,
      sentWithoutCheck: 0,
      spam: 0,
    });

    const read = await answer<Response>(
      send(t.managerA, 'GET', `/console/form-responses/${receipt.responseId}`),
    );
    expect(read.answers).toEqual({ f_rating: 'good', f_note: 'It was fine.' });
    expect(JSON.stringify(read.answers)).not.toContain('Counted');
    const viewed = await rowsOf<{ subject_party_id: string | null; actor_id: string }>(
      t.tenantA,
      `SELECT subject_party_id, actor_id FROM app.audit_event
        WHERE action = 'forms.response.viewed' AND entity_id = $1`,
      [receipt.responseId],
    );
    expect(viewed).toEqual([
      { subject_party_id: read.personId, actor_id: t.managerA.membershipId },
    ]);
    await answer(send(t.managerA, 'GET', `${FORMS}/${form.id}/responses`));
    expect(
      await rowsOf(
        t.tenantA,
        `SELECT 1 FROM app.audit_event WHERE action = 'forms.response.viewed' AND entity_id = $1`,
        [receipt.responseId],
      ),
    ).toHaveLength(1);
  });

  it('page with a cursor, filter by route and refuse a cursor that is not theirs', async () => {
    const { form, version } = await aForm();
    for (let index = 0; index < 3; index += 1) {
      await answer(
        submitAs(index === 0 ? applicantA : otherApplicantA, form.id, sent(version.id)),
        201,
      );
    }
    const all = await answer<Page>(send(t.managerA, 'GET', `${FORMS}/${form.id}/responses`));
    expect(all.responses).toHaveLength(3);
    const none = await answer<Page>(
      send(t.managerA, 'GET', `${FORMS}/${form.id}/responses?route=anonymous`),
    );
    expect(none.responses).toEqual([]);
    expect(
      (await send(t.managerA, 'GET', `${FORMS}/${form.id}/responses?cursor=AAAA`)).statusCode,
    ).toBe(400);
    expect(
      (await send(t.managerA, 'GET', `${FORMS}/${form.id}/responses?view=nope`)).statusCode,
    ).toBe(400);
    expect((await send(t.managerA, 'GET', `${FORMS}/${randomUUID()}/responses`)).statusCode).toBe(
      404,
    );
  });

  it('see another tenant’s responses as missing on every route, and change nothing', async () => {
    const { form, version } = await aForm();
    const receipt = await answer<Receipt>(submitAs(applicantA, form.id, sent(version.id)), 201);
    const before = await counts();

    const routes: [Method, (form: string, response: string) => string, unknown][] = [
      ['GET', (f) => `${FORMS}/${f}/responses`, undefined],
      ['GET', (f) => `${FORMS}/${f}/response-totals`, undefined],
      ['GET', (_f, r) => `/console/form-responses/${r}`, undefined],
      ['POST', (_f, r) => `/console/form-responses/${r}/spam`, { reason: 'test' }],
      ['POST', (_f, r) => `/console/form-responses/${r}/not-spam`, undefined],
    ];
    for (const [method, url, body] of routes) {
      const outside = await send(t.managerB, method, url(form.id, receipt.responseId), body);
      const missing = await send(t.managerB, method, url(randomUUID(), randomUUID()), body);
      expect(outside.statusCode, url(form.id, receipt.responseId)).toBe(404);
      expectLooksMissing(outside, missing);
    }
    expect(await counts()).toEqual(before);
  });

  it('finds an anonymous response by its reference, which never leaves the body', async () => {
    const { form, version } = await aForm({ respondents: 'anonymous' });
    const reference = newToken();
    const token = await tokenHash(HASH_KEY, reference);
    const made = await submit({
      slug: t.tenantA.slug,
      formId: form.id,
      formVersionId: version.id,
      answers: { f_rating: 'good' },
      tokenHash: token,
      proofHash: null,
    });
    expect(made.code).toBeNull();

    const found = await answer<Response>(
      send(t.managerA, 'POST', '/console/form-responses/lookup', { reference }),
    );
    expect(found).toMatchObject({
      id: made.response_id,
      route: 'anonymous',
      personId: null,
      sentWithoutCheck: true,
    });
    expect(JSON.stringify(found)).not.toContain(reference);
    const viewed = await events(t.tenantA, 'forms.response.viewed');
    expect(viewed.filter((row) => row.entity_id === made.response_id)).toHaveLength(1);

    const wrong = 'AgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
    expect(
      (await send(t.managerA, 'POST', '/console/form-responses/lookup', { reference: wrong }))
        .statusCode,
    ).toBe(404);
    expect(
      (await send(t.managerA, 'POST', '/console/form-responses/lookup', { reference: 'short' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await send(t.managerB, 'POST', '/console/form-responses/lookup', { reference })).statusCode,
    ).toBe(404);

    const without = await answer<Page>(
      send(t.managerA, 'GET', `${FORMS}/${form.id}/responses?view=without_check`),
    );
    expect(without.responses.map((response) => response.id)).toEqual([made.response_id]);
    const totals = await answer<Totals>(
      send(t.managerA, 'GET', `${FORMS}/${form.id}/response-totals`),
    );
    expect(totals).toMatchObject({ received: 1, anonymous: 1, sentWithoutCheck: 1 });
  });
});

describe('marking spam', () => {
  it('keeps a response out of the received list and the count, with one event for each change', async () => {
    const { form, version } = await aForm();
    const receipt = await answer<Receipt>(submitAs(applicantA, form.id, sent(version.id)), 201);
    const url = `/console/form-responses/${receipt.responseId}`;

    const marked = await answer<Summary>(
      send(t.managerA, 'POST', `${url}/spam`, { reason: 'duplicate' }),
    );
    expect(marked.spamReason).toBe('duplicate');
    await answer<Summary>(send(t.managerA, 'POST', `${url}/spam`, { reason: 'duplicate' }));
    const received = await answer<Page>(send(t.managerA, 'GET', `${FORMS}/${form.id}/responses`));
    const spam = await answer<Page>(
      send(t.managerA, 'GET', `${FORMS}/${form.id}/responses?view=spam`),
    );
    expect(received.responses).toEqual([]);
    expect(spam.responses.map((response) => response.id)).toEqual([receipt.responseId]);
    expect(
      await answer<Totals>(send(t.managerA, 'GET', `${FORMS}/${form.id}/response-totals`)),
    ).toMatchObject({ received: 0, spam: 1 });

    const [event, ...more] = (await events(t.tenantA, 'forms.response.marked_spam')).filter(
      (row) => row.entity_id === receipt.responseId,
    );
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      actor_id: t.managerA.membershipId,
      changes: { 'forms.response.spam_reason': { before: null, after: 'duplicate' } },
    });
    const stored = await rowsOf<{ spam_marked_by: string; spam_marked_at: Date }>(
      t.tenantA,
      `SELECT spam_marked_by, spam_marked_at FROM forms.response WHERE id = $1`,
      [receipt.responseId],
    );
    expect(stored[0]?.spam_marked_by).toBe(t.managerA.membershipId);
    expect(stored[0]?.spam_marked_at).toBeInstanceOf(Date);

    const cleared = await answer<Summary>(send(t.managerA, 'POST', `${url}/not-spam`));
    expect(cleared.spamReason).toBeNull();
    await answer<Summary>(send(t.managerA, 'POST', `${url}/not-spam`));
    expect(
      (await events(t.tenantA, 'forms.response.unmarked_spam')).filter(
        (row) => row.entity_id === receipt.responseId,
      ),
    ).toHaveLength(1);
    expect(
      (await answer<Page>(send(t.managerA, 'GET', `${FORMS}/${form.id}/responses`))).responses,
    ).toHaveLength(1);
    expect((await send(t.managerA, 'POST', `${url}/spam`, { reason: 'made up' })).statusCode).toBe(
      400,
    );
  });
});

describe('the anonymous routes', () => {
  const base = (formId: string) => `/public/tenants/${t.tenantA.slug}/forms/${formId}`;

  it('read a form, send a response with a solved check, replay a retry and refuse a proof used again', async (context) => {
    if (!publicFormExists) context.skip();
    const { form, version } = await aForm({ respondents: 'anonymous' });
    const open = await answer<{ formVersionId: string }>(send(undefined, 'GET', base(form.id)));
    expect(open.formVersionId).toBe(version.id);

    const proofOf = async () => {
      const issued = await answer<{ challenge: string; difficulty: number }>(
        send(undefined, 'GET', `${base(form.id)}/challenge`),
      );
      return solve(issued.challenge, issued.difficulty);
    };
    const post = (body: object, key: string) =>
      t.send(undefined, 'POST', `${base(form.id)}/responses`, body, 'console', null, key);
    const token = newToken();
    const request = async (change: object = {}) => ({
      formVersionId: version.id,
      respondentToken: token,
      proof: await proofOf(),
      answers: { f_rating: 'good' },
      ...change,
    });

    const key = randomUUID();
    const used = await request();
    const first = await answer<Receipt>(post(used, key), 201);
    expect(first.confirmationMessage).toBe('Thank you for telling us.');
    expect((await answer<Receipt>(post(await request(), key), 201)).responseId).toBe(
      first.responseId,
    );
    expect((await post(await request({ answers: { f_rating: 'poor' } }), key)).statusCode).toBe(
      409,
    );

    const again = await post({ ...used, respondentToken: newToken() }, randomUUID());
    expect(again.statusCode).toBe(400);
    expect(again.json<{ type: string }>().type).toBe('/problems/proof-invalid');
    const wrong = await post(
      {
        ...used,
        respondentToken: newToken(),
        proof: { ...(await proofOf()), nonces: Array(16).fill(0) },
      },
      randomUUID(),
    );
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ type: string }>().type).toBe('/problems/proof-invalid');
    const stored = await rowsOf<{ n: number }>(
      t.tenantA,
      `SELECT count(*)::int AS n FROM forms.response WHERE form_id = $1`,
      [form.id],
    );
    expect(stored).toEqual([{ n: 1 }]);

    const outside = await send(
      undefined,
      'GET',
      `/public/tenants/${t.tenantB.slug}/forms/${form.id}`,
    );
    expectLooksMissing(
      outside,
      await send(undefined, 'GET', `/public/tenants/${t.tenantB.slug}/forms/${randomUUID()}`),
    );
  });
});

describe('the anonymous routes’ database calls', () => {
  const settings = {
    proofKey: KEY('a'),
    hashKey: KEY('b'),
    difficulty: 8,
    noProof: true,
  };
  const deps = () =>
    formsPublicDependencies(
      pool,
      {
        notFound: () => new ApiError(404),
        refuse: (_status, detail, errors) => new ApiError(400, detail, { errors }),
      },
      settings,
      undefined,
    );
  const hash = () => randomBytes(32);

  async function aSubmission(change: object = {}) {
    const { form, version } = await aForm({ respondents: 'anonymous' });
    return {
      slug: t.tenantA.slug,
      formId: form.id,
      formVersionId: version.id,
      answers: { f_rating: 'good' },
      tokenHash: hash(),
      keyHash: hash(),
      requestHash: hash(),
      proofHash: hash(),
      requestId: randomUUID(),
      ...change,
    };
  }

  it('write one response for a key, replay it, and refuse a key or proof used for something else', async () => {
    const { forms } = deps();
    const submission = await aSubmission();

    const first = await forms.submit(submission);
    expect(first.code).toBe('ok');
    const replay = await forms.submit({
      ...submission,
      tokenHash: hash(),
      proofHash: hash(),
    });
    expect(replay).toEqual(first);
    expect(await forms.submit({ ...submission, requestHash: hash() })).toEqual({
      code: 'key_reused',
    });
    expect(await forms.submit({ ...submission, keyHash: hash(), tokenHash: hash() })).toEqual({
      code: 'proof_used',
    });
    expect(await forms.submit({ ...submission, keyHash: hash(), proofHash: hash() })).toEqual({
      code: 'key_reused',
    });
    const stored = await rowsOf<{ n: number; events: number }>(
      t.tenantA,
      `SELECT count(*)::int AS n,
              (SELECT count(*)::int FROM app.audit_event
                WHERE action = 'forms.response.submitted' AND request_id = $2) AS events
         FROM forms.response WHERE form_id = $1`,
      [submission.formId, submission.requestId],
    );
    expect(stored).toEqual([{ n: 1, events: 1 }]);
  });

  it('answer not found for an unknown tenant, a signed-in form or another tenant’s, and form-changed for a version the form does not take', async () => {
    const { forms } = deps();
    const submission = await aSubmission();
    const signedIn = await aForm();

    expect(await forms.submit({ ...submission, slug: 'no-such-tenant' })).toEqual({
      code: 'not_found',
    });
    expect(await forms.submit({ ...submission, slug: t.tenantB.slug })).toEqual({
      code: 'not_found',
    });
    expect(await forms.submit({ ...submission, formId: signedIn.form.id })).toEqual({
      code: 'not_found',
    });
    expect(await forms.submit({ ...submission, formVersionId: signedIn.version.id })).toEqual({
      code: 'form_changed',
    });
    expect(
      await rowsOf(t.tenantA, 'SELECT 1 FROM forms.response WHERE form_id = $1', [
        submission.formId,
      ]),
    ).toEqual([]);
  });

  it('count a key in its window apart from every other, and spend a proof once', async () => {
    const { limits, proofs } = deps();
    const subject = randomUUID();

    const counted = [
      await limits.count('public_form_submit', subject, 3600),
      await limits.count('public_form_submit', subject, 3600),
      await limits.count('public_form_challenge', subject, 3600),
    ];
    expect(counted.map(({ count }) => count)).toEqual([1, 2, 1]);

    const proof = hash();
    const issuedAt = new Date(Date.now() - 60_000);
    expect(await proofs.claim(proof, issuedAt)).toBe(true);
    expect(await proofs.claim(proof, issuedAt)).toBe(false);
    expect(await proofs.claim(hash(), issuedAt)).toBe(true);
  });
});
