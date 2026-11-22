// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { id, open, problem, session, stubFetch } from '../harness.test.tsx';

const CHECKLIST = id(1);
const APPLICATION = id(2);
const published = '2026-12-01T10:00:00.000Z';

const version = (number: number, versionId: number, items: unknown[]) => ({
  id: id(versionId),
  number,
  name: 'Governance checks',
  description: '',
  items,
  publishedAt: published,
});

const item = (n: number, label: string, kind = 'yes_no') => ({
  id: id(n),
  label,
  help: '',
  kind,
  required: true,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checklist list', () => {
  it('lists checklists with their version and offers to create one', async () => {
    stubFetch({
      'GET /console/checklists': {
        status: 200,
        body: {
          checklists: [
            { id: CHECKLIST, name: 'Governance checks', versionNumber: 2, publishedAt: published },
          ],
        },
      },
    });
    open('/assure/checklists');
    expect(await screen.findByRole('link', { name: 'Governance checks' })).toBeTruthy();
    expect(screen.getByText('Version 2')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Create checklist' }).length).toBeGreaterThan(0);
  });

  it('tells a member with no checklists what to do next', async () => {
    stubFetch({ 'GET /console/checklists': { status: 200, body: { checklists: [] } } });
    open('/assure/checklists');
    expect(await screen.findByText('No checklists yet')).toBeTruthy();
  });

  it('shows not found without the manage permission, and asks for nothing', async () => {
    const sent = stubFetch({});
    open('/assure/checklists', session(['assure.checklists.complete']));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: 'Create checklist' })).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('checklist editor', () => {
  it('creates a checklist from items with their own ids and no author or tenant', async () => {
    const user = userEvent.setup();
    const sent = stubFetch({
      'POST /console/checklists': {
        status: 201,
        body: { id: CHECKLIST, version: version(1, 3, [item(10, 'Has a constitution')]) },
      },
    });
    open('/assure/checklists/new');

    await user.type(await screen.findByLabelText('Name'), 'Governance checks');
    await user.type(screen.getByLabelText('Check'), 'Has a constitution');
    await user.click(screen.getByRole('button', { name: 'Review and create' }));
    await user.click(await screen.findByRole('button', { name: 'Create checklist' }));

    expect(await screen.findByText('Version 1 published')).toBeTruthy();
    const body = sent.find(({ key }) => key === 'POST /console/checklists')?.body as {
      items: { id: string }[];
    };
    expect(Object.keys(body).sort()).toEqual(['description', 'items', 'name']);
    expect(body.items[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('moves items with buttons and names each change before publishing a new version', async () => {
    const user = userEvent.setup();
    const sent = stubFetch({
      [`GET /console/checklists/${CHECKLIST}`]: {
        status: 200,
        body: {
          id: CHECKLIST,
          version: version(1, 3, [item(10, 'Has a constitution'), item(11, 'Has a policy')]),
        },
      },
      [`POST /console/checklists/${CHECKLIST}/versions`]: {
        status: 201,
        body: {
          id: CHECKLIST,
          version: version(2, 4, [item(11, 'Has a policy'), item(10, 'Has a constitution')]),
        },
      },
    });
    open(`/assure/checklists/${CHECKLIST}`);

    expect(await screen.findByText(/Version 1, published/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Move item 1 down' }));
    await user.click(screen.getByRole('button', { name: 'Review and publish' }));
    expect(await screen.findByText('The order of the items changes.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Publish new version' }));

    expect(await screen.findByText('Version 2 published')).toBeTruthy();
    expect(sent.filter(({ key }) => key.startsWith('POST'))).toHaveLength(1);
  });

  it('warns that a new answer kind is a new question', async () => {
    const user = userEvent.setup();
    stubFetch({
      [`GET /console/checklists/${CHECKLIST}`]: {
        status: 200,
        body: { id: CHECKLIST, version: version(1, 3, [item(10, 'Has a constitution')]) },
      },
    });
    open(`/assure/checklists/${CHECKLIST}`);
    await user.selectOptions(await screen.findByLabelText('Answer kind'), 'date');
    expect(screen.getByText(/makes this a new question/)).toBeTruthy();
  });

  it('offers to reload when a version was skipped', async () => {
    const user = userEvent.setup();
    stubFetch({
      [`GET /console/checklists/${CHECKLIST}`]: {
        status: 200,
        body: { id: CHECKLIST, version: version(1, 3, [item(10, 'Has a constitution')]) },
      },
      [`POST /console/checklists/${CHECKLIST}/versions`]: problem(
        409,
        'Someone else published a new version. Reload the checklist and try again.',
      ),
    });
    open(`/assure/checklists/${CHECKLIST}`);
    await user.type(await screen.findByLabelText(/^Description/), 'Updated');
    await user.click(screen.getByRole('button', { name: 'Review and publish' }));
    await user.click(await screen.findByRole('button', { name: 'Publish new version' }));
    expect(await screen.findByText(/Someone else published a new version/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload checklist' })).toBeTruthy();
  });
});

describe('checklist answers', () => {
  const RESPONSE = `/console/applications/${APPLICATION}/checklists/${CHECKLIST}`;
  const pinned = {
    checklistId: CHECKLIST,
    applicationId: APPLICATION,
    version: version(1, 3, [
      item(10, 'Has a constitution'),
      item(11, 'Reviewed on', 'date'),
      item(12, 'Notes', 'short_text'),
    ]),
    answers: {},
    complete: false,
    savedAt: null,
  };

  it('shows the pinned version, saves keyed by item id and sends nothing blank', async () => {
    const user = userEvent.setup();
    const sent = stubFetch({
      [`GET /console/applications/${APPLICATION}/checklists`]: {
        status: 200,
        body: {
          checklists: [
            {
              checklistId: CHECKLIST,
              name: 'Governance checks',
              versionId: id(3),
              complete: false,
              savedAt: null,
            },
          ],
        },
      },
      [`GET ${RESPONSE}`]: { status: 200, body: pinned },
      [`PUT ${RESPONSE}`]: {
        status: 200,
        body: {
          ...pinned,
          answers: { [id(10)]: { kind: 'yes_no', value: 'yes' } },
          complete: true,
          savedAt: published,
        },
      },
    });
    open(`/assure/applications/${APPLICATION}`, session(['assure.checklists.complete']));

    expect(await screen.findByText(/Answering version 1 of Governance checks/)).toBeTruthy();
    expect(screen.getByText(/0 of 500 characters/)).toBeTruthy();
    await user.click(screen.getByLabelText('Yes'));
    await user.click(screen.getByRole('button', { name: 'Save answers' }));

    expect(await screen.findByText('Answers saved.')).toBeTruthy();
    const put = sent.find(({ key }) => key.startsWith('PUT'));
    expect(put?.body).toEqual({
      versionId: id(3),
      answers: { [id(10)]: { kind: 'yes_no', value: 'yes' } },
    });
    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeTruthy();
    });
  });
});
