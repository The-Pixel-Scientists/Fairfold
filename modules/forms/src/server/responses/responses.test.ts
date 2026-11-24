// SPDX-License-Identifier: AGPL-3.0-or-later

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it, vi } from 'vitest';

import { tokenHash } from '../public/hash.ts';
import { encodeCursor } from '../staff/forms.ts';
import {
  responseRefusals,
  type DetailRow,
  type OpenForm,
  type OwnDetail,
  type ResponseContext,
  type ResponseDependencies,
  type ResponseStore,
  type SummaryRow,
} from './context.ts';
import { formsResolvers, responseHandlers } from './index.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const OTHER = 'c4d81b2f-7e65-4a03-8f9c-1b5e6a2d3c47';
const VERSION = '0b6f3c1e-58a2-4d1b-9c47-2e8d5f1a7b30';
const PERSON = '2e8d5f1a-7b30-4c1d-9c47-58a20b6f3c1e';
const MEMBER = '6f1c2d3e-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const TOKEN = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const KEY = new Uint8Array(32).fill(2);

const definition = formDefinitionSchema.parse({
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
        { id: 'f_note', type: 'short_text', label: 'Note', classification: 'personal' },
        {
          id: 'f_count',
          type: 'short_text',
          label: 'Counted only',
          audiences: 'aggregate_only',
          classification: 'special_category',
        },
        { id: 'f_file', type: 'file', label: 'A file' },
      ],
    },
  ],
});

const summary: SummaryRow = {
  id: ID,
  formId: OTHER,
  formVersionId: VERSION,
  version: 1,
  route: 'signed_in',
  personId: PERSON,
  submittedAt: new Date('2027-03-01T10:00:00.123Z'),
  sentWithoutCheck: false,
  spamReason: null,
};

const detail = (change: Partial<DetailRow> = {}): DetailRow => ({
  ...summary,
  definition,
  answers: { f_rating: 'good', f_note: 'Private', f_count: 'secret' },
  ...change,
});

const openForm: OpenForm = {
  id: OTHER,
  title: 'Feedback',
  description: null,
  closesAt: null,
  confirmationMessage: 'Thank you.',
  formVersionId: VERSION,
  definition,
};

function setup(store: Partial<ResponseStore> = {}, hashKey: Uint8Array | null = KEY) {
  const written: { action: string; entityId: string; [key: string]: unknown }[] = [];
  const read: { action: string; entityId: string; subjectPartyId?: string }[] = [];
  const context: ResponseContext = {
    membership: { id: MEMBER },
    session: { userId: 'user-1', email: () => Promise.resolve('ada@example.org') },
    audit: {
      record: (event) => {
        written.push(event);
        return Promise.resolve();
      },
      read: (event) => {
        read.push(event);
        return Promise.resolve();
      },
    },
  };
  const ensurePerson = vi.fn(() => Promise.resolve({ personId: PERSON, created: true }));
  const full = {
    formExists: () => Promise.resolve(true),
    personFor: () => Promise.resolve(PERSON),
    signedInVersion: () => Promise.resolve({ id: VERSION, definition }),
    ...store,
  } as ResponseStore;
  const deps: ResponseDependencies<null> = {
    notFound: () => new Error('not found'),
    refuse: (status, detail, errors) => Object.assign(new Error(detail), { status, errors }),
    formChanged: () => new Error('form changed'),
    store: () => full,
    hashKey: hashKey ?? undefined,
    ensurePerson,
  };
  const handlers = responseHandlers(deps);
  const args = <I>(input: I) => ({ tx: null, context, input });
  return { handlers, args, written, read, ensurePerson };
}

describe('reading a response as staff', () => {
  it('shows only the staff projection and records a sensitive read about the respondent', async () => {
    const { handlers, args, read } = setup({ find: () => Promise.resolve(detail()) });

    const response = await handlers.getResponse(args({ params: { responseId: ID } }));

    expect(response.answers).toEqual({ f_rating: 'good', f_note: 'Private' });
    expect(response.submittedAt).toBe('2027-03-01T10:00:00.123Z');
    expect(read).toEqual([
      { action: 'forms.response.viewed', entityId: ID, subjectPartyId: PERSON },
    ]);
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('names no party for an anonymous response', async () => {
    const { handlers, args, read } = setup({
      find: () => Promise.resolve(detail({ route: 'anonymous', personId: null })),
    });

    await handlers.getResponse(args({ params: { responseId: ID } }));

    expect(read).toEqual([{ action: 'forms.response.viewed', entityId: ID }]);
  });

  it('answers 404 for a response that is not there, and records nothing', async () => {
    const { handlers, args, read } = setup({ find: () => Promise.resolve(undefined) });

    await expect(handlers.getResponse(args({ params: { responseId: ID } }))).rejects.toThrow(
      'not found',
    );
    expect(read).toEqual([]);
  });

  it('finds a response by the keyed hash of its reference, never the reference itself', async () => {
    const findByToken = vi.fn(() =>
      Promise.resolve(detail({ route: 'anonymous', personId: null })),
    );
    const { handlers, args, read } = setup({ findByToken });

    await handlers.findResponseByReference(args({ body: { reference: TOKEN } }));

    expect(findByToken).toHaveBeenCalledWith(await tokenHash(KEY, TOKEN));
    expect(read).toHaveLength(1);
  });

  it('finds nothing without the key, or for a reference that is not stored', async () => {
    const none = setup({ findByToken: () => Promise.resolve(undefined) });
    await expect(
      none.handlers.findResponseByReference(none.args({ body: { reference: TOKEN } })),
    ).rejects.toThrow('not found');
    const keyless = setup({ findByToken: () => Promise.resolve(detail()) }, null);
    await expect(
      keyless.handlers.findResponseByReference(keyless.args({ body: { reference: TOKEN } })),
    ).rejects.toThrow('not found');
    expect(keyless.read).toEqual([]);
  });
});

describe('listing responses', () => {
  const query = { view: 'received' as const };

  it('pages with a cursor made from the last response shown', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      ...summary,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    const { handlers, args } = setup({ list: () => Promise.resolve(rows) });

    const page = await handlers.listResponses(args({ params: { formId: OTHER }, query }));

    expect(page.responses).toHaveLength(50);
    expect(page.nextCursor).toBe(
      encodeCursor({ updatedAt: summary.submittedAt, id: rows[49]?.id ?? '' }),
    );
  });

  it('refuses a cursor it did not make, and an unknown form', async () => {
    const { handlers, args } = setup({ list: () => Promise.resolve([]) });
    await expect(
      handlers.listResponses(
        args({ params: { formId: OTHER }, query: { ...query, cursor: 'AAAA' } }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    const missing = setup({ formExists: () => Promise.resolve(false) });
    await expect(
      missing.handlers.listResponses(missing.args({ params: { formId: OTHER }, query })),
    ).rejects.toThrow('not found');
    await expect(
      missing.handlers.getResponseTotals(missing.args({ params: { formId: OTHER }, query: {} })),
    ).rejects.toThrow('not found');
  });
});

describe('marking spam', () => {
  it('sets the mark with the reason code and the acting member, and records it', async () => {
    const setSpam = vi.fn(() => Promise.resolve());
    const { handlers, args, written } = setup({ find: () => Promise.resolve(detail()), setSpam });

    const marked = await handlers.markResponseSpam(
      args({ params: { responseId: ID }, body: { reason: 'automated' } }),
    );

    expect(setSpam).toHaveBeenCalledWith(ID, 'automated', MEMBER);
    expect(marked.spamReason).toBe('automated');
    expect(written).toEqual([
      {
        action: 'forms.response.marked_spam',
        entityId: ID,
        changes: { 'forms.response.spam_reason': { before: null, after: 'automated' } },
        subjectPartyId: PERSON,
      },
    ]);
  });

  it('changes and records nothing when the mark is already as asked', async () => {
    const setSpam = vi.fn(() => Promise.resolve());
    const { handlers, args, written } = setup({
      find: () => Promise.resolve(detail({ spamReason: 'automated' })),
      setSpam,
    });

    await handlers.markResponseSpam(
      args({ params: { responseId: ID }, body: { reason: 'automated' } }),
    );
    const fresh = setup({ find: () => Promise.resolve(detail()), setSpam });
    await fresh.handlers.unmarkResponseSpam(fresh.args({ params: { responseId: ID } }));

    expect(setSpam).not.toHaveBeenCalled();
    expect([...written, ...fresh.written]).toEqual([]);
  });

  it('clears the mark and records it', async () => {
    const setSpam = vi.fn(() => Promise.resolve());
    const { handlers, args, written } = setup({
      find: () => Promise.resolve(detail({ spamReason: 'test' })),
      setSpam,
    });

    const cleared = await handlers.unmarkResponseSpam(args({ params: { responseId: ID } }));

    expect(setSpam).toHaveBeenCalledWith(ID, null, MEMBER);
    expect(cleared.spamReason).toBeNull();
    expect(written[0]).toMatchObject({ action: 'forms.response.unmarked_spam' });
  });
});

describe('answering as a signed-in person', () => {
  const body = (answers: Record<string, unknown>, formVersionId = VERSION) => ({
    params: { formId: OTHER },
    body: { formVersionId, answers: answers as never },
  });

  it('submits cleaned answers against the version named, and audits it with the person', async () => {
    const submit = vi.fn(() => Promise.resolve(ID));
    const receipt = {
      responseId: ID,
      submittedAt: new Date('2027-03-01T10:00:00Z'),
      confirmationMessage: 'Thank you.',
    };
    const { handlers, args, written, ensurePerson } = setup({
      submit,
      receipt: () => Promise.resolve(receipt),
      personFor: () => Promise.resolve(null),
    });

    const answered = await handlers.submitMyResponse(
      args(body({ f_rating: 'good', f_note: '  ' })),
    );

    expect(submit).toHaveBeenCalledWith(
      OTHER,
      PERSON,
      VERSION,
      { f_rating: 'good', f_note: null },
      MEMBER,
    );
    expect(ensurePerson).toHaveBeenCalledWith(null, { userId: 'user-1', email: 'ada@example.org' });
    expect(answered).toEqual({
      responseId: ID,
      submittedAt: '2027-03-01T10:00:00.000Z',
      confirmationMessage: 'Thank you.',
    });
    expect(written.map(({ action }) => action)).toEqual([
      'party.person.created',
      'forms.response.submitted',
    ]);
    expect(written[1]).toMatchObject({ entityId: ID, subjectPartyId: PERSON });
    expect(JSON.stringify(written)).not.toContain('good');
  });

  it('answers form-changed for a version the form does not take, and stores nothing', async () => {
    const submit = vi.fn();
    const { handlers, args, written } = setup({
      submit,
      signedInVersion: () => Promise.resolve(undefined),
    });

    await expect(handlers.submitMyResponse(args(body({ f_rating: 'good' })))).rejects.toThrow(
      'form changed',
    );
    await expect(handlers.saveMyFormDraft(args(body({ f_rating: 'good' })))).rejects.toThrow(
      'form changed',
    );
    expect(submit).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('refuses answers that fail the form, by field id, and answers to a file question', async () => {
    const submit = vi.fn();
    const { handlers, args } = setup({ submit });

    await expect(
      handlers.submitMyResponse(args(body({ f_note: 'No rating' }))),
    ).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'f_rating' }],
    });
    await expect(
      handlers.submitMyResponse(args(body({ f_rating: 'good', f_file: [OTHER] }))),
    ).rejects.toMatchObject({
      status: 400,
      errors: [{ field: 'f_file', message: responseRefusals.noFiles }],
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('saves a draft with the answers given so far and shows only questions that are on the form, without an audit event', async () => {
    const saved = {
      formVersionId: VERSION,
      definition,
      answers: { f_note: 'Half done', f_unknown: 'stale' },
      updatedAt: new Date('2027-03-01T10:00:00Z'),
    };
    const saveDraft = vi.fn(() => Promise.resolve(saved));
    const { handlers, args, written } = setup({ saveDraft });

    const draft = await handlers.saveMyFormDraft(args(body({ f_note: 'Half done' })));

    expect(saveDraft).toHaveBeenCalledWith(OTHER, PERSON, VERSION, { f_note: 'Half done' }, MEMBER);
    expect(draft.answers).toEqual({ f_note: 'Half done' });
    expect(written).toEqual([]);
  });

  it('reads an empty draft for a person with none, and no person at all', async () => {
    const none = setup({ draft: () => Promise.resolve(undefined) });
    const empty = { formVersionId: null, answers: {}, updatedAt: null };
    expect(await none.handlers.getMyFormDraft(none.args({ params: { formId: OTHER } }))).toEqual(
      empty,
    );

    const stranger = setup({ personFor: () => Promise.resolve(null) });
    expect(
      await stranger.handlers.getMyFormDraft(stranger.args({ params: { formId: OTHER } })),
    ).toEqual(empty);
    expect(stranger.ensurePerson).not.toHaveBeenCalled();
  });

  it('reads only the caller own responses, as the respondent sees them', async () => {
    const own: OwnDetail = {
      id: ID,
      formId: OTHER,
      formTitle: 'Feedback',
      submittedAt: summary.submittedAt,
      formVersionId: VERSION,
      definition,
      answers: { f_rating: 'good', f_count: 'secret' },
    };
    const ownOne = vi.fn<ResponseStore['ownOne']>(() => Promise.resolve(own));
    const { handlers, args } = setup({ ownOne });

    const response = await handlers.getMyResponse(args({ params: { responseId: ID } }));

    expect(ownOne).toHaveBeenCalledWith(ID, PERSON);
    expect(response.answers).toEqual({ f_rating: 'good', f_count: 'secret' });
    expect(Object.keys(response)).not.toContain('spamReason');

    const stranger = setup({ ownOne: () => Promise.resolve(undefined) });
    await expect(
      stranger.handlers.getMyResponse(stranger.args({ params: { responseId: ID } })),
    ).rejects.toThrow('not found');
  });

  it('reads a form taking answers, and refuses one that is not', async () => {
    const open = setup({ openForm: () => Promise.resolve(openForm) });
    expect(
      await open.handlers.getPortalForm(open.args({ params: { formId: OTHER } })),
    ).toMatchObject({
      id: OTHER,
      description: '',
      formVersionId: VERSION,
    });
    const closed = setup({ openForm: () => Promise.resolve(undefined) });
    await expect(
      closed.handlers.getPortalForm(closed.args({ params: { formId: OTHER } })),
    ).rejects.toThrow('not found');
  });
});

describe('the portal scope rules', () => {
  it('reach a form only while it takes answers, and a response only if it is the caller own', async () => {
    const store = {
      openForm: (formId: string) => Promise.resolve(formId === OTHER ? openForm : undefined),
      personFor: (userId: string) => Promise.resolve(userId === 'user-1' ? PERSON : null),
      ownOne: (responseId: string, person: string) =>
        Promise.resolve(responseId === ID && person === PERSON ? ({} as OwnDetail) : undefined),
    } as ResponseStore;
    const rules = formsResolvers({ store: () => store });

    expect(await rules.open_form({ tx: null, input: { params: { formId: OTHER } } })).toBe(true);
    expect(await rules.open_form({ tx: null, input: { params: { formId: ID } } })).toBe(false);
    expect(await rules.open_form({ tx: null, input: { params: { formId: 'nope' } } })).toBe(false);

    const own = (userId: string, params: unknown) =>
      rules.own_response({ tx: null, userId, input: { params } });
    expect(await own('user-1', { responseId: ID })).toBe(true);
    expect(await own('user-2', { responseId: ID })).toBe(false);
    expect(await own('user-1', { responseId: OTHER })).toBe(false);
    expect(await own('user-1', undefined)).toBe(true);
  });
});
