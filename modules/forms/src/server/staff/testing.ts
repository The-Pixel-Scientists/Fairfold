// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the staff handlers: an in-memory store that keeps the
// database's rules the handlers rely on (one draft, fixed published versions,
// numbers that count up), and a context that records what a handler wrote.
// Synthetic data only.

import { formDefinitionSchema, type FormDefinition } from '@pixel-scientists/domain/forms';

import type { FormSettingsInput } from '../../contracts/index.ts';
import type { DraftRow, FormRow, StaffContext, StaffDependencies, StaffStore } from './context.ts';
import { staffHandlers } from './index.ts';

export const ACTOR = '6f1c2d3e-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

export const settings: FormSettingsInput = {
  title: 'Event feedback',
  description: '',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  confirmationMessage: '',
};

/** A one-section definition whose questions are the given ids and types. */
export function definitionOf(...questions: [id: string, type: 'short_text' | 'yes_no'][]) {
  return formDefinitionSchema.parse({
    sections: [
      {
        id: 's_one',
        title: 'Your feedback',
        fields: questions.map(([id, type]) => ({
          id,
          type,
          label: `Question ${id}`,
          classification: 'internal',
        })),
      },
    ],
  });
}

interface Version {
  id: string;
  formId: string;
  version: number;
  status: 'draft' | 'published';
  definition: FormDefinition | null;
  respondents: FormRow['respondents'] | null;
  updatedAt: Date;
}

const when = (time: string | null): Date | null => (time === null ? null : new Date(time));

const randomUUID = () => globalThis.crypto.randomUUID();

function memoryStore() {
  const forms = new Map<string, FormRow>();
  const versions: Version[] = [];
  let tick = 0;
  const time = () => new Date(Date.UTC(2027, 0, 1, 10, 0, ++tick));
  const draftOf = (formId: string) =>
    versions.find((v) => v.formId === formId && v.status === 'draft');
  const draftById = (id: string) => versions.find((v) => v.id === id && v.status === 'draft');
  const asDraft = (v: Version): DraftRow => ({
    id: v.id,
    version: v.version,
    definition: v.definition,
    updatedAt: v.updatedAt,
  });
  const published = (formId: string) =>
    versions.filter((v) => v.formId === formId && v.status === 'published');
  const withLatest = (row: FormRow): FormRow => ({
    ...row,
    latestVersion: published(row.id).at(-1)?.version ?? null,
  });
  const respondents = (v: Version) => v.respondents as FormRow['respondents'];

  const store: StaffStore = {
    list: ({ status, limit }) =>
      Promise.resolve(
        [...forms.values()]
          .map(withLatest)
          .filter(
            (row) => status === undefined || (row.latestVersion === null) === (status === 'draft'),
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, limit),
      ),
    find: (formId) => {
      const row = forms.get(formId);
      return Promise.resolve(row === undefined ? undefined : withLatest(row));
    },
    insert: (input, definition) => {
      const id = randomUUID();
      const now = time();
      forms.set(id, {
        id,
        title: input.title,
        description: input.description === '' ? null : input.description,
        respondents: input.respondents,
        opensAt: when(input.opensAt),
        closesAt: when(input.closesAt),
        retentionMonths: 12,
        confirmationMessage: input.confirmationMessage,
        latestVersion: null,
        createdAt: now,
        updatedAt: now,
      });
      versions.push({
        id: randomUUID(),
        formId: id,
        version: 1,
        status: 'draft',
        definition,
        respondents: null,
        updatedAt: now,
      });
      return Promise.resolve(id);
    },
    updateSettings: (formId, input) => {
      const row = forms.get(formId) as FormRow;
      forms.set(formId, {
        ...row,
        ...input,
        description: input.description === '' ? null : input.description,
        opensAt: when(input.opensAt),
        closesAt: when(input.closesAt),
        updatedAt: time(),
      });
      return Promise.resolve();
    },
    updateRetention: (formId, months) => {
      const row = forms.get(formId) as FormRow;
      forms.set(formId, { ...row, retentionMonths: months, updatedAt: time() });
      return Promise.resolve();
    },
    draft: (formId) => {
      const found = draftOf(formId);
      return Promise.resolve(found === undefined ? undefined : asDraft(found));
    },
    insertDraft: (formId, version, definition) => {
      const created: Version = {
        id: randomUUID(),
        formId,
        version,
        status: 'draft',
        definition,
        respondents: null,
        updatedAt: time(),
      };
      versions.push(created);
      return Promise.resolve(asDraft(created));
    },
    saveDraft: (draftId, definition) => {
      const found = draftById(draftId) as Version;
      Object.assign(found, { definition, updatedAt: time() });
      return Promise.resolve(asDraft(found));
    },
    published: (formId) =>
      Promise.resolve(
        published(formId).map((v) => ({ respondents: respondents(v), definition: v.definition })),
      ),
    versions: (formId) =>
      Promise.resolve(
        published(formId)
          .toReversed()
          .map((v) => ({
            id: v.id,
            formId,
            version: v.version,
            respondents: respondents(v),
            publishedAt: v.updatedAt,
          })),
      ),
    version: (formId, versionId) => {
      const found = published(formId).find((v) => v.id === versionId);
      return Promise.resolve(
        found === undefined
          ? undefined
          : {
              id: found.id,
              formId,
              version: found.version,
              respondents: respondents(found),
              definition: found.definition,
              publishedAt: found.updatedAt,
            },
      );
    },
    latestConfigVersion: () => Promise.resolve(randomUUID()),
    publish: (draftId, definition) => {
      const found = draftById(draftId) as Version;
      const form = forms.get(found.formId) as FormRow;
      Object.assign(found, {
        status: 'published',
        definition,
        respondents: form.respondents,
        updatedAt: time(),
      });
      return Promise.resolve();
    },
  };
  return { store, versions };
}

export interface Written {
  audit: { action: string; entityId: string; changes?: object }[];
  config: { entityType: string; entityId: string; diff: unknown }[];
}

/** The handlers on a fresh in-memory store, and what each request wrote. */
export function handlersOnMemory() {
  const memory = memoryStore();
  const written: Written = { audit: [], config: [] };
  const context: StaffContext = {
    membership: { id: ACTOR },
    audit: {
      record: (event) => {
        written.audit.push(event);
        return Promise.resolve();
      },
    },
    config: {
      record: (entityType, entityId, diff) => {
        written.config.push({ entityType, entityId, diff });
        return Promise.resolve();
      },
    },
  };
  const deps: StaffDependencies<null> = {
    notFound: () => new Error('not found'),
    refuse: (status, detail, errors) => Object.assign(new Error(detail), { status, errors }),
    store: () => memory.store,
  };
  const handlers = staffHandlers(deps);
  const args = <I>(input: I) => ({ tx: null, context, input });
  return { handlers, args, written, versions: memory.versions };
}
