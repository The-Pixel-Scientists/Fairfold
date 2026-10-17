// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the form builder: open a draft, and find what is on it.
// Not part of the app.

import { screen, within } from '@testing-library/react';
import { expect } from 'vitest';

import { stubApi } from '../testing/api.ts';
import { containing, joined } from '../testing/names.ts';
import { openConsole } from '../testing/render.tsx';
import { api, draft, ids, ok, reads } from './fixtures.ts';
import type { Handlers } from './fixtures.ts';

/** What saving the draft sends: the key. */
export const SAVE = api.save(ids.draft);

/** Opens a draft at its address, with the answers a test adds to the reads, and waits for the page. */
export async function openDraft(more: Handlers = {}, version = draft) {
  const sent = stubApi({ ...reads(version), ...more });
  openConsole(`/northfield/rounds/${ids.round}/form/${version.id}`);
  await screen.findByRole('heading', { level: 1, name: 'Application form' });
  await screen.findByText(/^Version \d+, draft$/);
  return sent;
}

/** A save the API accepts: it answers with the draft holding the definition it was sent. */
export const saves: Handlers = {
  [SAVE]: (body) =>
    ok({
      ...draft,
      definition: (body as { definition: unknown }).definition,
      updatedAt: '2026-10-15T10:00:00.000Z',
    }),
};

/** A button named by what it does and what it does it to: "Move down" and "Organisation name". */
export const actionButton = (verb: string, name: string) =>
  screen.getByRole('button', { name: joined(verb, name) });

export const sectionList = () => screen.getByRole('list', { name: 'Sections' });
export const sectionButton = (title: string) =>
  within(sectionList()).getByRole('button', { name: containing(title) });

export const questionList = () => screen.getByRole('list', { name: 'Questions' });
export const questionButton = (label: string) =>
  within(questionList()).getByRole('button', { name: containing(label) });

/** Says the questions of the section that is showing are these, in this order. */
export function expectQuestions(...labels: string[]): void {
  const items = within(questionList()).getAllByRole('listitem');
  expect(items.map((item) => labels.find((label) => item.textContent.includes(label)))).toEqual(
    labels,
  );
}

export const editor = (name: 'Edit question' | 'Edit section' | 'Edit text' = 'Edit question') =>
  screen.getByRole('region', { name });

/** The body of the one request a test sent to `key`. */
export function bodyOf(sent: readonly { key: string; body: unknown }[], key: string): unknown {
  const requests = sent.filter((request) => request.key === key);
  if (requests.length !== 1)
    throw new Error(`Expected one ${key}, saw ${String(requests.length)}.`);
  return requests[0]?.body;
}

/** The definition the one save of a test sent. */
export const savedDefinition = (sent: readonly { key: string; body: unknown }[]) =>
  (bodyOf(sent, SAVE) as { definition: { sections: Section[] } }).definition;

interface Section {
  id: string;
  title: string;
  introduction?: string;
  fields: Record<string, unknown>[];
}
