// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms staff routes through the whole API against the test database, as
// app_api: sessions, the policy, row-level security, configuration versions
// and the audit log, for two tenants.

import { randomUUID } from 'node:crypto';

import { formsMessages, feedbackTemplates } from '@pixel-scientists/forms/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestTenant } from '../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../test/modules-on.ts';
import {
  answer,
  rowsOf,
  startProgrammeApi,
  type Method,
  type Problem,
  type ProgrammeApi,
} from '../../test/programme-api.ts';
import {
  addMember,
  events,
  versions as allConfigVersions,
  type Member,
} from '../../test/settings-api.ts';
import { expectLooksMissing } from '../../test/support.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

interface Form {
  id: string;
  title: string;
  description: string;
  respondents: string;
  retentionMonths: number;
  status: string;
  latestVersion: number | null;
}

interface Draft {
  formId: string;
  definition: { sections: { fields: { id: string }[] }[] } | null;
}

interface Version {
  id: string;
  version: number;
  respondents: string;
  formId: string;
}

const FORMS = '/console/forms';
const TEMPLATES = '/console/feedback-templates';

const settings = (change: object = {}) => ({
  title: 'Event feedback',
  description: 'What people thought.',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  confirmationMessage: 'Thank you.',
  ...change,
});

/** A one-section definition with the given questions, each a short text answer unless it says otherwise. */
const definition = (...questions: [id: string, type?: 'short_text' | 'yes_no'][]) => ({
  sections: [
    {
      id: 's_one',
      title: 'Your feedback',
      fields: questions.map(([id, type = 'short_text']) => ({
        id,
        type,
        label: `Question ${id}`,
        classification: 'internal',
      })),
    },
  ],
});

let t: ProgrammeApi;
let tenantOff: Awaited<ReturnType<typeof createTestTenant>>;
let adminB: Member;

beforeAll(async () => {
  t = await startProgrammeApi('41390');
  await switchModule(t.tenantA, 'forms');
  await switchModule(t.tenantB, 'forms');
  tenantOff = await createTestTenant();
  adminB = await addMember(t.tenantB, 'console', 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await t.close();
});

const send = (method: Method, url: string, body?: unknown, member: Member = t.managerA) =>
  t.send(member, method, url, body);

const aForm = (change: object = {}) => answer<Form>(send('POST', FORMS, settings(change)), 201);

/** A form of tenant A with a draft of the given questions. */
async function aDraft(...questions: Parameters<typeof definition>) {
  const form = await aForm();
  await answer(send('PUT', `${FORMS}/${form.id}/draft`, { definition: definition(...questions) }));
  return form;
}

/** A form's configuration versions, oldest first. */
const storedVersions = async (formId: string) =>
  (await allConfigVersions(t.tenantA, 'forms.form')).filter((row) => row.entity_id === formId);

const publish = (formId: string, member: Member = t.managerA) =>
  send('POST', `${FORMS}/${formId}/versions`, undefined, member);

const counts = () =>
  rowsOf(
    t.tenantA,
    `SELECT (SELECT count(*) FROM forms.form)::int AS forms,
            (SELECT count(*) FROM forms.form_version)::int AS versions,
            (SELECT count(*) FROM forms.form_version WHERE status = 'published')::int AS published,
            (SELECT count(*) FROM app.config_version)::int AS configs,
            (SELECT count(*) FROM app.audit_event WHERE action LIKE 'forms.%')::int AS events`,
  );

/** Every staff route, with a valid request for the ids given. */
function everyRoute(
  formId: string,
  versionId: string,
  templateId: string,
): [Method, string, unknown][] {
  return [
    ['GET', FORMS, undefined],
    ['POST', FORMS, settings()],
    ['GET', `${FORMS}/${formId}`, undefined],
    ['PUT', `${FORMS}/${formId}/settings`, settings({ title: 'Renamed' })],
    ['PUT', `${FORMS}/${formId}/retention`, { retentionMonths: 6 }],
    ['GET', `${FORMS}/${formId}/draft`, undefined],
    ['PUT', `${FORMS}/${formId}/draft`, { definition: definition(['f_one']) }],
    ['GET', `${FORMS}/${formId}/preview?audience=staff`, undefined],
    ['GET', `${FORMS}/${formId}/versions`, undefined],
    ['GET', `${FORMS}/${formId}/versions/${versionId}`, undefined],
    ['POST', `${FORMS}/${formId}/versions`, undefined],
    ['GET', TEMPLATES, undefined],
    ['GET', `${TEMPLATES}/${templateId}`, undefined],
    ['POST', `${TEMPLATES}/${templateId}/forms`, settings()],
  ];
}

const templateId = feedbackTemplates[0].id;

describe('who may use the forms routes', () => {
  it('refuse a reviewer, an applicant, an administrator and a signed-out caller, and change nothing', async () => {
    const form = await aDraft(['f_one']);
    const version = await answer<Version>(publish(form.id), 201);
    const before = await counts();
    const routes = everyRoute(form.id, version.id, templateId);
    expect(routes).toHaveLength(14);

    for (const [method, url, body] of routes) {
      for (const [who, member] of [
        ['a reviewer', t.reviewerA],
        ['an applicant', t.applicantA],
        ['an administrator', t.adminA],
      ] as const) {
        const response = await send(method, url, body, member);
        expect(response.statusCode, `${method} ${url} as ${who}`).toBe(403);
      }
      const inPortal = await t.send(t.managerA, method, url, body, 'portal');
      expect(inPortal.statusCode, `${method} ${url} in the portal`).toBe(403);
      const signedOut = await t.send(undefined, method, url, body);
      expect(signedOut.statusCode, `${method} ${url} signed out`).toBe(401);
    }
    expect(await counts()).toEqual(before);
  });

  it('keep retention for a member who confirmed it is them', async () => {
    const form = await aForm();
    const url = `${FORMS}/${form.id}/retention`;
    const body = { retentionMonths: 24 };

    const noStepUp = await t.send(t.adminA, 'PUT', url, body);
    expect(noStepUp.statusCode).toBe(403);
    const manager = await t.send(t.managerA, 'PUT', url, body, 'console', new Date());
    expect(manager.statusCode).toBe(403);

    const changed = await answer<Form>(t.send(t.adminA, 'PUT', url, body, 'console', new Date()));
    expect(changed.retentionMonths).toBe(24);
  });

  it('answer 404 on every route while forms is off, and keep the rows', async () => {
    const owner = await addMember(tenantOff, 'console', 'programme_manager');
    const admin = await addMember(tenantOff, 'console', 'tenant_admin');
    for (const [method, url, body] of everyRoute(randomUUID(), randomUUID(), templateId)) {
      const response = url.endsWith('/retention')
        ? await t.send(admin, method, url, body, 'console', new Date())
        : await send(method, url, body, owner);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
    await switchModule(tenantOff, 'forms');
    const made = await answer<Form>(send('POST', FORMS, settings(), owner), 201);
    await switchModule(tenantOff, 'forms', false);
    expect((await send('GET', `${FORMS}/${made.id}`, undefined, owner)).statusCode).toBe(404);
    expect(await rowsOf(tenantOff, 'SELECT count(*)::int AS n FROM forms.form')).toEqual([
      { n: 1 },
    ]);
  });
});

describe('another tenant’s forms', () => {
  it('read as missing on every route that takes an id, and nothing of theirs changes', async () => {
    const form = await aDraft(['f_one']);
    const version = await answer<Version>(publish(form.id), 201);
    const before = await counts();
    const real = everyRoute(form.id, version.id, templateId);
    const absent = everyRoute(randomUUID(), randomUUID(), templateId);
    let withId = 0;
    for (const [index, [method, url, body]] of real.entries()) {
      if (!url.startsWith(`${FORMS}/`) || url.endsWith('/retention')) continue;
      withId += 1;
      const outside = await send(method, url, body, t.managerB);
      const missing = await send(method, absent[index]?.[1] ?? '', absent[index]?.[2], t.managerB);
      expect(outside.statusCode, `${method} ${url}`).toBe(404);
      expectLooksMissing(outside, missing);
    }
    expect(withId).toBe(8);
    const retention = (id: string) =>
      t.send(
        adminB,
        'PUT',
        `${FORMS}/${id}/retention`,
        { retentionMonths: 6 },
        'console',
        new Date(),
      );
    expectLooksMissing(await retention(form.id), await retention(randomUUID()));
    expect(await counts()).toEqual(before);
    const listed = await answer<{ forms: unknown[] }>(send('GET', FORMS, undefined, t.managerB));
    expect(listed.forms).toEqual([]);
  });

  it('read as missing when the form is the caller’s own but the version is another’s', async () => {
    const [one, other] = [await aDraft(['f_one']), await aDraft(['f_one'])];
    const version = await answer<Version>(publish(other.id), 201);

    const response = await send('GET', `${FORMS}/${one.id}/versions/${version.id}`);

    expect(response.statusCode).toBe(404);
  });
});

describe('a form', () => {
  it('is made with an empty draft, a configuration version and an audit event, and a replay makes nothing more', async () => {
    const key = randomUUID();
    const body = settings({ title: 'Private title' });
    const post = () => t.send(t.managerA, 'POST', FORMS, body, 'console', null, key);

    const made = await answer<Form>(post(), 201);
    expect(made).toMatchObject({
      title: 'Private title',
      respondents: 'signed_in',
      retentionMonths: 12,
      status: 'draft',
      latestVersion: null,
    });
    expect((await answer<Form>(post(), 201)).id).toBe(made.id);

    const versions = await storedVersions(made.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, author_id: t.managerA.membershipId });
    const fields = versions[0]?.diff.changes.map((change) => change.field) ?? [];
    expect(fields).toEqual(['title', 'description', 'confirmationMessage']);

    const created = (await events(t.tenantA, 'forms.form.created')).filter(
      (row) => row.entity_id === made.id,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.actor_id).toBe(t.managerA.membershipId);
    expect(JSON.stringify(created[0]?.changes)).not.toContain('Private title');
    const draft = await answer<Draft>(send('GET', `${FORMS}/${made.id}/draft`));
    expect(draft).toMatchObject({ formId: made.id, definition: null });
  });

  it('takes a settings change as its next configuration version, and a save that changes nothing as none', async () => {
    const form = await aForm();
    const url = `${FORMS}/${form.id}/settings`;
    expect((await answer<Form>(send('PUT', url, settings()))).title).toBe(form.title);

    const changed = settings({
      title: 'Renamed',
      respondents: 'both',
      closesAt: '2027-06-01T17:00:00Z',
    });
    const next = await answer<Form>(send('PUT', url, changed));

    expect(next).toMatchObject({ title: 'Renamed', respondents: 'both' });
    const versions = await storedVersions(form.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[1]?.diff.changes).toEqual([
      { field: 'title', from: form.title, to: 'Renamed' },
      { field: 'respondents', from: 'signed_in', to: 'both' },
      { field: 'closesAt', from: null, to: '2027-06-01T17:00:00Z' },
    ]);
    const [event] = (await events(t.tenantA, 'forms.form.updated')).filter(
      (row) => row.entity_id === form.id,
    );
    expect(event?.changes['forms.form.title']).toEqual({});
    expect(event?.changes['forms.form.respondents']).toEqual({
      before: 'signed_in',
      after: 'both',
    });
  });

  it('refuses settings that break a rule, and more than 12 months for a form anyone can answer', async () => {
    const form = await aForm();
    const settingsUrl = `${FORMS}/${form.id}/settings`;
    const retentionUrl = `${FORMS}/${form.id}/retention`;
    const asAdmin = (url: string, body: unknown) =>
      t.send(t.adminA, 'PUT', url, body, 'console', new Date());

    const closed = await send(
      'PUT',
      settingsUrl,
      settings({ opensAt: '2027-06-02T09:00:00Z', closesAt: '2027-06-01T09:00:00Z' }),
    );
    expect(closed.statusCode).toBe(400);
    expect((await send('PUT', settingsUrl, { ...settings(), extra: true })).statusCode).toBe(400);
    expect((await send('PUT', settingsUrl, settings({ title: '  ' }))).statusCode).toBe(400);

    await answer(asAdmin(retentionUrl, { retentionMonths: 36 }));
    const tooLong = await send('PUT', settingsUrl, settings({ respondents: 'anonymous' }));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json<Problem>().errors).toEqual([
      { field: 'body.respondents', message: formsMessages.anonymousRetention },
    ]);
    await answer(asAdmin(retentionUrl, { retentionMonths: 12 }));
    await answer(send('PUT', settingsUrl, settings({ respondents: 'anonymous' })));
    const longer = await asAdmin(retentionUrl, { retentionMonths: 13 });
    expect(longer.statusCode).toBe(400);
    expect((await asAdmin(retentionUrl, { retentionMonths: 0 })).statusCode).toBe(400);

    const [event] = (await events(t.tenantA, 'forms.form.retention_changed')).filter(
      (row) => row.entity_id === form.id,
    );
    expect(event?.changes['forms.form.retention_months']).toEqual({ before: 12, after: 36 });
  });

  it('is listed the most recently changed first, a page at a time, and by status', async () => {
    const tenant = await createTestTenant();
    await switchModule(tenant, 'forms');
    const owner = await addMember(tenant, 'console', 'programme_manager');
    const made: Form[] = [];
    for (let n = 0; n < 52; n += 1) {
      made.push(
        await answer<Form>(
          send('POST', FORMS, settings({ title: `Form ${String(n)}` }), owner),
          201,
        ),
      );
    }
    await answer(
      send('PUT', `${FORMS}/${made[1]?.id ?? ''}/settings`, settings({ title: 'Touched' }), owner),
    );

    type Page = { forms: { id: string; title: string }[]; nextCursor: string | null };
    const first = await answer<Page>(send('GET', FORMS, undefined, owner));
    expect(first.forms).toHaveLength(50);
    expect(first.forms[0]?.title).toBe('Touched');
    expect(first.nextCursor).not.toBeNull();
    const second = await answer<Page>(
      send('GET', `${FORMS}?cursor=${first.nextCursor ?? ''}`, undefined, owner),
    );
    expect(second.forms).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.forms, ...second.forms].map((row) => row.id);
    expect(new Set(ids).size).toBe(52);

    const published = await answer<Page>(
      send('GET', `${FORMS}?status=published`, undefined, owner),
    );
    expect(published.forms).toEqual([]);
    expect((await send('GET', `${FORMS}?cursor=not-a-cursor`, undefined, owner)).statusCode).toBe(
      400,
    );
    expect((await send('GET', `${FORMS}?status=archived`, undefined, owner)).statusCode).toBe(400);
  });
});

describe('a draft', () => {
  it('is replaced as a whole, audited, previewed by audience and never stored by a preview', async () => {
    const form = await aForm();
    const url = `${FORMS}/${form.id}/draft`;
    const body = { definition: definition(['f_name'], ['f_again', 'yes_no']) };

    const saved = await answer<Draft>(send('PUT', url, body));
    await answer(send('PUT', url, body));

    expect(saved.definition?.sections[0]?.fields.map((f) => f.id)).toEqual(['f_name', 'f_again']);
    const audited = (await events(t.tenantA, 'forms.form_draft.saved')).filter(
      (row) => row.changes['forms.form_version.definition'] !== undefined,
    );
    expect(audited.length).toBeGreaterThanOrEqual(1);
    const before = await counts();
    for (const audience of ['respondent', 'staff']) {
      const preview = await answer<{ visibleFieldIds: string[] }>(
        send('GET', `${FORMS}/${form.id}/preview?audience=${audience}`),
      );
      expect(preview.visibleFieldIds).toEqual(['f_name', 'f_again']);
    }
    expect((await send('GET', `${FORMS}/${form.id}/preview?audience=reviewer`)).statusCode).toBe(
      400,
    );
    expect(await counts()).toEqual(before);
  });

  it('refuses a definition the form engine rejects, naming the field, and keeps the last good draft', async () => {
    const form = await aDraft(['f_name']);
    const url = `${FORMS}/${form.id}/draft`;
    const broken = {
      sections: [
        {
          id: 's_one',
          title: 'Your feedback',
          fields: [
            { id: 'f_a', type: 'short_text', label: 'A', classification: 'internal' },
            { id: 'f_a', type: 'short_text', label: 'B', classification: 'internal' },
          ],
        },
      ],
    };

    const refused = await send('PUT', url, { definition: broken });

    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().errors?.length).toBeGreaterThan(0);
    expect((await send('PUT', url, { definition: { sections: 'no' } })).statusCode).toBe(400);
    expect((await send('PUT', url, { definition: definition(['f_a']), extra: 1 })).statusCode).toBe(
      400,
    );
    const draft = await answer<Draft>(send('GET', url));
    expect(draft.definition?.sections[0]?.fields.map((f) => f.id)).toEqual(['f_name']);
  });

  it('cannot be published before it is saved', async () => {
    const form = await aForm();

    const response = await publish(form.id);

    expect(response.statusCode).toBe(409);
  });
});

describe('publishing', () => {
  it('fixes the draft as version 1 with its configuration version and audit event, and a second publish is refused', async () => {
    const form = await aDraft(['f_name']);
    const key = randomUUID();
    const post = () =>
      t.send(t.managerA, 'POST', `${FORMS}/${form.id}/versions`, undefined, 'console', null, key);

    const first = await answer<Version & { definition: unknown }>(post(), 201);

    expect(first).toMatchObject({ version: 1, respondents: 'signed_in', formId: form.id });
    expect((await answer<Version>(post(), 201)).id).toBe(first.id);
    const [stored] = await rowsOf<{
      status: string;
      published_by: string;
      config_version_id: string;
      respondents: string;
    }>(
      t.tenantA,
      `SELECT status, published_by, config_version_id, respondents
         FROM forms.form_version WHERE id = $1`,
      [first.id],
    );
    expect(stored).toMatchObject({
      status: 'published',
      published_by: t.managerA.membershipId,
      respondents: 'signed_in',
    });
    const versions = await storedVersions(form.id);
    expect(versions).toHaveLength(2);
    const configs = await rowsOf<{ id: string }>(
      t.tenantA,
      `SELECT id FROM app.config_version WHERE entity_id = $1 AND version = 2`,
      [form.id],
    );
    expect(stored?.config_version_id).toBe(configs[0]?.id);
    const [event] = (await events(t.tenantA, 'forms.form_version.published')).filter(
      (row) => row.entity_id === first.id,
    );
    expect(event?.changes).toEqual({
      'forms.form_version.version': { before: null, after: 1 },
      'forms.form_version.status': { before: 'draft', after: 'published' },
      'forms.form_version.respondents': { before: null, after: 'signed_in' },
    });

    const again = await publish(form.id);
    expect(again.statusCode).toBe(409);
    const read = await answer<Form>(send('GET', `${FORMS}/${form.id}`));
    expect(read).toMatchObject({ status: 'published', latestVersion: 1 });
    const published = await answer<{ forms: { id: string }[] }>(
      send('GET', `${FORMS}?status=published`),
    );
    expect(published.forms.map((row) => row.id)).toContain(form.id);
  });

  it('starts the next draft from the last version, and numbers the next version 2', async () => {
    const form = await aDraft(['f_name']);
    const first = await answer<Version>(publish(form.id), 201);
    const url = `${FORMS}/${form.id}/draft`;

    const starting = await answer<Draft>(send('GET', url));
    expect(starting.definition?.sections[0]?.fields.map((f) => f.id)).toEqual(['f_name']);
    await answer(send('PUT', url, { definition: definition(['f_name'], ['f_again', 'yes_no']) }));
    const second = await answer<Version>(publish(form.id), 201);

    expect(second.version).toBe(2);
    const listed = await answer<{ versions: Version[] }>(
      send('GET', `${FORMS}/${form.id}/versions`),
    );
    expect(listed.versions.map((row) => row.version)).toEqual([2, 1]);
    const kept = await answer<{ definition: Draft['definition'] }>(
      send('GET', `${FORMS}/${form.id}/versions/${first.id}`),
    );
    expect(kept.definition?.sections[0]?.fields.map((f) => f.id)).toEqual(['f_name']);
  });

  it('checks the draft against every earlier version, and names field ids only', async () => {
    const form = await aDraft(['f_a'], ['f_b']);
    await answer(publish(form.id), 201);
    const url = `${FORMS}/${form.id}/draft`;
    await answer(send('PUT', url, { definition: definition(['f_a']) }));
    await answer(publish(form.id), 201);
    await answer(send('PUT', url, { definition: definition(['f_a'], ['f_b', 'yes_no']) }));

    const refused = await publish(form.id);

    expect(refused.statusCode).toBe(400);
    expect(refused.json<Problem>().errors).toEqual([
      { field: 'f_b', message: formsMessages.typeChanged },
    ]);
    expect(refused.body).not.toContain('Question f_b');
    const [row] = await rowsOf<{ n: number }>(
      t.tenantA,
      `SELECT count(*)::int AS n FROM forms.form_version WHERE form_id = $1 AND status = 'published'`,
      [form.id],
    );
    expect(row?.n).toBe(2);
  });
});

describe('feedback templates', () => {
  it('are listed and read with their questions, and an unknown one is missing', async () => {
    const listed = await answer<{ templates: { id: string; questions: number }[] }>(
      send('GET', TEMPLATES),
    );
    expect(listed.templates.map((row) => row.id)).toEqual(feedbackTemplates.map((row) => row.id));
    expect(listed.templates.every((row) => row.questions === 4)).toBe(true);

    const one = await answer<{ id: string; definition: unknown }>(
      send('GET', `${TEMPLATES}/${templateId}`),
    );
    expect(one.definition).toEqual(feedbackTemplates[0].definition);
    expect((await send('GET', `${TEMPLATES}/${randomUUID()}`)).statusCode).toBe(404);
    expect((await send('POST', `${TEMPLATES}/${randomUUID()}/forms`, settings())).statusCode).toBe(
      404,
    );
  });

  it('start a form whose draft is a copy, with its configuration version and audit event', async () => {
    const key = randomUUID();
    const post = () =>
      t.send(
        t.managerA,
        'POST',
        `${TEMPLATES}/${templateId}/forms`,
        settings(),
        'console',
        null,
        key,
      );

    const made = await answer<Form>(post(), 201);
    expect((await answer<Form>(post(), 201)).id).toBe(made.id);

    const draft = await answer<Draft>(send('GET', `${FORMS}/${made.id}/draft`));
    expect(draft.definition).toEqual(feedbackTemplates[0].definition);
    expect(await storedVersions(made.id)).toHaveLength(1);
    expect(
      (await events(t.tenantA, 'forms.form.created')).filter((row) => row.entity_id === made.id),
    ).toHaveLength(1);
    expect(await answer<Version>(publish(made.id), 201)).toMatchObject({ version: 1 });
  });
});
