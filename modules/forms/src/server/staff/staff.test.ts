// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formsMessages } from '../../contracts/index.ts';
import { auditChanges, decodeCursor, encodeCursor, settingsDiff } from './forms.ts';
import { definitionOf, handlersOnMemory, settings } from './testing.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('settings changes', () => {
  it('lists each setting that changed, with an empty description as none', () => {
    const diff = settingsDiff(
      { ...settings, description: 'Before' },
      { ...settings, description: '', title: 'Renamed', respondents: 'both' },
    );

    expect(diff).toEqual([
      { field: 'title', from: 'Event feedback', to: 'Renamed' },
      { field: 'description', from: 'Before', to: null },
      { field: 'respondents', from: 'signed_in', to: 'both' },
    ]);
    expect(settingsDiff(settings, settings)).toEqual([]);
  });

  it('keeps no typed text in an audit event, only the names of what changed', () => {
    const changes = auditChanges(
      settingsDiff(settings, {
        ...settings,
        title: 'Private title',
        confirmationMessage: 'Private words',
        respondents: 'anonymous',
        opensAt: '2027-02-01T09:00:00Z',
      }),
    );

    expect(changes).toEqual({
      'forms.form.title': {},
      'forms.form.confirmation_message': {},
      'forms.form.respondents': { before: 'signed_in', after: 'anonymous' },
      'forms.form.opens_at': { before: null, after: '2027-02-01T09:00:00Z' },
    });
  });
});

describe('page cursors', () => {
  it('read back what they were made from, and refuse anything else', () => {
    const after = { updatedAt: new Date('2027-01-01T10:00:00.123Z'), id: ID };

    expect(decodeCursor(encodeCursor(after))).toEqual(after);
    for (const bad of ['', 'AAAA', Buffer.from(`2027-01-01|${ID}`).toString('base64url')]) {
      expect(decodeCursor(bad), bad).toBeUndefined();
    }
    const extra = Buffer.from(`2027-01-01T10:00:00.000Z|${ID}|x`).toString('base64url');
    expect(decodeCursor(extra)).toBeUndefined();
  });
});

describe('creating a form', () => {
  it('writes the first configuration version and audit event, without the title', async () => {
    const { handlers, args, written } = handlersOnMemory();

    const form = await handlers.createForm(args({ body: settings }));

    expect(form).toMatchObject({ title: 'Event feedback', status: 'draft', latestVersion: null });
    expect(written.config).toEqual([
      {
        entityType: 'forms.form',
        entityId: form.id,
        diff: [{ field: 'title', from: '', to: 'Event feedback' }],
      },
    ]);
    expect(written.audit).toEqual([
      { action: 'forms.form.created', entityId: form.id, changes: { 'forms.form.title': {} } },
    ]);
  });

  it('starts a form from a template, with its questions as the draft', async () => {
    const { handlers, args } = handlersOnMemory();
    const [first] = (await handlers.listFeedbackTemplates()).templates;

    const form = await handlers.createFormFromTemplate(
      args({ params: { templateId: first?.id ?? '' }, body: settings }),
    );

    const draft = await handlers.getFormDraft(args({ params: { formId: form.id } }));
    expect(draft.definition?.sections).toHaveLength(1);
    expect(first?.questions).toBe(4);
    await expect(
      handlers.getFeedbackTemplate(args({ params: { templateId: ID } })),
    ).rejects.toThrow('not found');
  });
});

describe('retention', () => {
  it('refuses more than 12 months for a form anyone can answer, on both routes', async () => {
    const { handlers, args } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };
    await handlers.updateFormRetention(args({ params, body: { retentionMonths: 36 } }));

    await expect(
      handlers.updateFormSettings(args({ params, body: { ...settings, respondents: 'both' } })),
    ).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'body.respondents', message: formsMessages.anonymousRetention }],
    });
    await handlers.updateFormRetention(args({ params, body: { retentionMonths: 6 } }));
    await handlers.updateFormSettings(args({ params, body: { ...settings, respondents: 'both' } }));
    await expect(
      handlers.updateFormRetention(args({ params, body: { retentionMonths: 13 } })),
    ).rejects.toMatchObject({
      errors: [{ field: 'body.retentionMonths', message: formsMessages.anonymousRetention }],
    });
  });

  it('writes nothing for a change that changes nothing', async () => {
    const { handlers, args, written } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const before = structuredClone(written);
    const params = { formId: form.id };

    await handlers.updateFormSettings(args({ params, body: settings }));
    await handlers.updateFormRetention(args({ params, body: { retentionMonths: 12 } }));

    expect(written).toEqual(before);
  });
});

describe('the draft', () => {
  it('is replaced as a whole, audited on each save, and previewed by audience', async () => {
    const { handlers, args, written } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };
    const definition = definitionOf(['f_name', 'short_text'], ['f_again', 'yes_no']);

    await handlers.saveFormDraft(args({ params, body: { definition } }));
    await handlers.saveFormDraft(args({ params, body: { definition } }));

    expect(written.audit.filter((e) => e.action === 'forms.form_draft.saved')).toHaveLength(2);
    const preview = await handlers.previewFormDraft(args({ params, query: { audience: 'staff' } }));
    expect(preview.visibleFieldIds).toEqual(['f_name', 'f_again']);
    await expect(
      handlers.previewFormDraft(args({ params: { formId: ID }, query: { audience: 'staff' } })),
    ).rejects.toThrow('not found');
  });

  it('cannot be previewed or published before it has questions', async () => {
    const { handlers, args } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };

    await expect(
      handlers.previewFormDraft(args({ params, query: { audience: 'respondent' } })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(handlers.publishForm(args({ params }))).rejects.toMatchObject({ status: 409 });
  });
});

describe('publishing', () => {
  it('numbers the versions, refuses a second publish of one draft, and starts the next draft from the last version', async () => {
    const { handlers, args, written, versions } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };
    await handlers.saveFormDraft(
      args({ params, body: { definition: definitionOf(['f_name', 'short_text']) } }),
    );

    const first = await handlers.publishForm(args({ params }));

    expect(first).toMatchObject({ version: 1, respondents: 'signed_in', formId: form.id });
    expect(written.audit.at(-1)).toMatchObject({
      action: 'forms.form_version.published',
      entityId: first.id,
    });
    expect(written.config.at(-1)).toMatchObject({
      entityType: 'forms.form',
      diff: [{ field: 'respondents', from: 'signed_in', to: 'signed_in' }],
    });
    await expect(handlers.publishForm(args({ params }))).rejects.toMatchObject({ status: 409 });

    const draft = await handlers.getFormDraft(args({ params }));
    expect(draft.definition).toEqual(first.definition);
    await handlers.saveFormDraft(
      args({
        params,
        body: { definition: definitionOf(['f_name', 'short_text'], ['f_again', 'yes_no']) },
      }),
    );
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, 'published'],
      [2, 'draft'],
    ]);
    expect((await handlers.publishForm(args({ params }))).version).toBe(2);
    const listed = await handlers.listFormVersions(args({ params }));
    expect(listed.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(
      await handlers.getFormVersion(args({ params: { formId: form.id, formVersionId: first.id } })),
    ).toEqual(first);
  });

  it('checks a draft against every earlier version, naming field ids only', async () => {
    const { handlers, args } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };
    const publish = async (...questions: Parameters<typeof definitionOf>) => {
      const definition = definitionOf(...questions);
      await handlers.saveFormDraft(args({ params, body: { definition } }));
      return handlers.publishForm(args({ params }));
    };

    await publish(['f_a', 'short_text'], ['f_b', 'short_text']);
    await publish(['f_a', 'short_text']);

    await expect(publish(['f_a', 'short_text'], ['f_b', 'yes_no'])).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'f_b', message: formsMessages.typeChanged }],
    });
  });

  it('refuses a file question on a form anyone can answer, and publishes it for signed-in people', async () => {
    const { handlers, args } = handlersOnMemory();
    const form = await handlers.createForm(args({ body: settings }));
    const params = { formId: form.id };
    const definition = definitionOf(['f_a', 'short_text']);
    definition.sections[0]?.fields.push({
      id: 'f_file',
      type: 'file',
      label: 'A document',
      classification: 'personal',
    } as never);
    await handlers.saveFormDraft(args({ params, body: { definition } }));
    await handlers.updateFormSettings(
      args({ params, body: { ...settings, respondents: 'anonymous' } }),
    );

    await expect(handlers.publishForm(args({ params }))).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'f_file', message: formsMessages.anonymousFile }],
    });
    await handlers.updateFormSettings(args({ params, body: settings }));
    expect(await handlers.publishForm(args({ params }))).toMatchObject({ version: 1 });
  });
});
