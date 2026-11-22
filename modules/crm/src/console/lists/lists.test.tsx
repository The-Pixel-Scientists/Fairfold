// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetNames } from '../labels.tsx';
import { id, open, organisationRecord, session, stubFetch } from '../harness.test.tsx';

const LIST = id(10);
const SEGMENT = id(20);
const ADA = id(1);

const list = {
  id: LIST,
  name: 'Cohort 2026',
  description: null,
  members: 2,
  archivedAt: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const manager = session(['crm.lists.manage', 'crm.segments.manage']);

beforeEach(() => {
  forgetNames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('lists', () => {
  it('shows lists with member counts and nothing to send', async () => {
    stubFetch({
      'GET /console/crm/lists': { status: 200, body: { lists: [list], nextCursor: null } },
    });
    open('/crm/lists', session([]));

    expect(await screen.findByRole('link', { name: 'Cohort 2026' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create list' })).toBeNull();
    expect(screen.queryByRole('button', { name: /send|export/i })).toBeNull();
    expect(screen.getByText(/Nothing is sent to a list/)).toBeTruthy();
  });

  it('tells a member with nothing yet what to do next', async () => {
    stubFetch({ 'GET /console/crm/lists': { status: 200, body: { lists: [], nextCursor: null } } });
    open('/crm/lists', manager);
    expect(await screen.findByText('No lists yet')).toBeTruthy();
    expect(screen.getByText(/Create a list, then add organisations and people/)).toBeTruthy();
  });

  it('creates a list with an idempotency key and no member or tenant id', async () => {
    const sent = stubFetch({
      'GET /console/crm/lists': { status: 200, body: { lists: [list], nextCursor: null } },
      'POST /console/crm/lists': { status: 201, body: list },
    });
    const user = userEvent.setup();
    open('/crm/lists', manager);

    await user.click(await screen.findByRole('button', { name: 'Create list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create list' });
    await user.type(within(dialog).getByLabelText('Name'), 'Cohort 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Create list' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const post = sent.find(({ key }) => key === 'POST /console/crm/lists');
    expect(post?.body).toEqual({ name: 'Cohort 2026' });
    expect(post?.headers['Idempotency-Key']).toBeTruthy();
  });

  it('archives a list after saying members are kept', async () => {
    const sent = stubFetch({
      'GET /console/crm/lists': { status: 200, body: { lists: [list], nextCursor: null } },
      [`POST /console/crm/lists/${LIST}/archive`]: {
        status: 200,
        body: { ...list, archivedAt: '2026-11-19T10:00:00.000Z' },
      },
    });
    const user = userEvent.setup();
    open('/crm/lists', manager);

    await user.click(await screen.findByRole('button', { name: 'Archive list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive list' });
    expect(dialog.textContent).toContain('The members are kept, and nothing is sent.');
    await user.click(within(dialog).getByRole('button', { name: 'Archive list' }));
    await waitFor(() => {
      expect(sent.some(({ key }) => key.endsWith('/archive'))).toBe(true);
    });
  });
});

describe('list members', () => {
  const members = {
    members: [{ partyId: ADA, kind: 'organisation', addedAt: '2026-11-01T10:00:00.000Z' }],
    nextCursor: null,
  };

  it('adds searched records and removes a member, with terms and ids in the body only', async () => {
    const sent = stubFetch({
      [`GET /console/crm/lists/${LIST}/members`]: { status: 200, body: members },
      [`GET /console/crm/organisations/${ADA}`]: {
        status: 200,
        body: organisationRecord('Riverside Trust'),
      },
      'POST /console/crm/search': {
        status: 200,
        body: {
          results: [
            {
              id: id(2),
              kind: 'organisation',
              label: 'Riverside Club',
              status: 'active',
              verification: 'none',
            },
          ],
          nextCursor: null,
        },
      },
      [`POST /console/crm/lists/${LIST}/members`]: {
        status: 200,
        body: { changed: 1, unchanged: 0 },
      },
      [`POST /console/crm/lists/${LIST}/members/removal`]: {
        status: 200,
        body: { changed: 1, unchanged: 0 },
      },
    });
    const user = userEvent.setup();
    open(`/crm/lists/${LIST}`, manager);

    expect(await screen.findByRole('link', { name: 'Riverside Trust' })).toBeTruthy();
    await user.type(screen.getByLabelText('Search'), 'Riverside');
    await user.click(screen.getByRole('button', { name: 'Search records' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select Riverside Club' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 to list' }));
    expect(await screen.findByText('Added 1 to the list.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Riverside Trust' })).toBeNull();
    });

    expect(sent.find(({ key }) => key === 'POST /console/crm/search')?.body).toMatchObject({
      term: 'Riverside',
    });
    expect(
      sent.find(({ key }) => key.endsWith(`${LIST}/members`) && key.startsWith('POST'))?.body,
    ).toEqual({
      partyIds: [id(2)],
    });
    expect(sent.find(({ key }) => key.endsWith('/removal'))?.body).toEqual({ partyIds: [ADA] });
    expect(window.location.href).not.toContain('Riverside');
  });

  it('offers no add or remove to a member who cannot manage lists', async () => {
    stubFetch({
      [`GET /console/crm/lists/${LIST}/members`]: { status: 200, body: members },
      [`GET /console/crm/organisations/${ADA}`]: {
        status: 200,
        body: organisationRecord('Riverside Trust'),
      },
    });
    open(`/crm/lists/${LIST}`, session([]));
    expect(await screen.findByRole('link', { name: 'Riverside Trust' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove from list' })).toBeNull();
    expect(screen.queryByText('Add records to this list')).toBeNull();
  });
});

describe('segments', () => {
  it('saves a segment from the closed fields, and keeps the filters out of the address', async () => {
    const sent = stubFetch({
      'GET /console/crm/segments': { status: 200, body: { segments: [], nextCursor: null } },
      'GET /console/crm/lists': { status: 200, body: { lists: [list], nextCursor: null } },
      'POST /console/crm/segments': {
        status: 201,
        body: {
          id: SEGMENT,
          name: 'Charities',
          description: null,
          filters: {
            '00000000-0000-4000-8000-000000000001': {
              field: 'legal_form',
              operator: 'eq',
              value: 'registered_charity',
            },
          },
          version: 1,
          archivedAt: null,
          updatedAt: '2026-11-19T10:00:00.000Z',
        },
      },
      [`GET /console/crm/segments/${SEGMENT}`]: {
        status: 200,
        body: {
          id: SEGMENT,
          name: 'Charities',
          description: null,
          filters: {
            '00000000-0000-4000-8000-000000000001': {
              field: 'legal_form',
              operator: 'eq',
              value: 'registered_charity',
            },
          },
          version: 1,
          archivedAt: null,
          updatedAt: '2026-11-19T10:00:00.000Z',
        },
      },
      [`GET /console/crm/segments/${SEGMENT}/members`]: {
        status: 200,
        body: { members: [], nextCursor: null },
      },
    });
    const user = userEvent.setup();
    open('/crm/segments', manager);

    expect(await screen.findByText('No segments yet')).toBeTruthy();
    await user.type(await screen.findByLabelText('Name'), 'Charities');
    await user.selectOptions(screen.getByLabelText('Field 1'), 'legal_form');
    await user.selectOptions(screen.getByLabelText('Value 1'), 'registered_charity');
    expect(screen.getByText(/as a new version/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save segment' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Charities' })).toBeTruthy();
    expect(screen.getByText('Legal form is Registered charity')).toBeTruthy();
    const post = sent.find(({ key }) => key === 'POST /console/crm/segments');
    const [filter] = Object.values((post?.body as { filters: Record<string, unknown> }).filters);
    expect(filter).toEqual({ field: 'legal_form', operator: 'eq', value: 'registered_charity' });
    expect(post?.headers['Idempotency-Key']).toBeTruthy();
    expect(window.location.href).not.toContain('registered_charity');
    expect(window.location.search).toBe('');
  });
});
