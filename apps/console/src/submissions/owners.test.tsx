// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { api, detail, listReads, ok, summary, uuid } from './fixtures.ts';

setUpConsoleTests();

const BULK = 'POST /console/submission-owners';
const MEMBERS = `GET /console/submissions/${uuid(101)}/mentionable-members`;
const ada = { membershipId: uuid(701), name: 'Ada Reed' };
const submissions = [summary(1), summary(2)];

const box = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const bar = () => within(screen.getByRole('group', { name: 'Bulk actions' }));

async function openList(more = {}, rows = submissions) {
  const sent = stubApi({
    ...listReads(rows),
    [MEMBERS]: ok({ members: [ada, { membershipId: uuid(702), name: null }] }),
    ...more,
  });
  openConsole('/northfield/submissions');
  await screen.findByRole('table', { name: 'Submissions' });
  return sent;
}

async function chooseOwner(user: ReturnType<typeof userEvent.setup>) {
  await user.click(box('Select Harbourside Youth Project'));
  await user.click(bar().getByRole('button', { name: 'Assign owner' }));
  const dialog = await screen.findByRole('dialog', { name: 'Assign owner' });
  await within(dialog).findByRole('option', { name: 'Ada Reed' });
  return dialog;
}

describe('the owner of chosen submissions', () => {
  it('assigns one of the members the server lists, by id, and says how many changed', async () => {
    const user = userEvent.setup();
    const sent = await openList({ [BULK]: ok({ changed: 2 }) });
    await user.click(box('Select Millbrook Allotment Society'));
    const dialog = await chooseOwner(user);
    expect(within(dialog).getByRole('option', { name: 'A team member' })).toBeTruthy();
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Owner' }),
      ada.membershipId,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Assign owner' }));

    expect(await screen.findByText('Owner assigned to 2 submissions.')).toBeTruthy();
    expect(sent.find(({ key }) => key === BULK)?.body).toEqual({
      submissionIds: [uuid(101), uuid(102)],
      ownerId: ada.membershipId,
    });
  });

  it('asks for a member before sending anything', async () => {
    const user = userEvent.setup();
    const sent = await openList();
    const dialog = await chooseOwner(user);

    await user.click(within(dialog).getByRole('button', { name: 'Assign owner' }));

    const select = within(dialog).getByRole('combobox', { name: 'Owner' });
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(select);
    expect(
      select
        .getAttribute('aria-describedby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' '),
    ).toContain('Choose a member to own the submissions.');
    expect(within(dialog).queryByRole('alert')).toBeNull();

    await user.selectOptions(select, 'Ada Reed');
    expect(select.getAttribute('aria-invalid')).toBeNull();
    expect(sent.some(({ key }) => key === BULK)).toBe(false);
  });

  it('clears the owner with no member list', async () => {
    const user = userEvent.setup();
    const sent = await openList({ [BULK]: ok({ changed: 1 }) });
    await user.click(box('Select Harbourside Youth Project'));

    await user.click(bar().getByRole('button', { name: 'Clear owner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear owner' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear owner' }));

    expect(await screen.findByText('Owner cleared from 1 submission.')).toBeTruthy();
    expect(sent.find(({ key }) => key === BULK)?.body).toEqual({
      submissionIds: [uuid(101)],
      ownerId: null,
    });
    expect(sent.some(({ key }) => key === MEMBERS)).toBe(false);
  });

  it('keeps the selection and shows the words of the server when it refuses', async () => {
    const user = userEvent.setup();
    const words = 'The person you chose cannot view applications. Choose someone who can.';
    await openList({ [BULK]: problem(400, words) });
    const dialog = await chooseOwner(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Owner' }),
      ada.membershipId,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Assign owner' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(words);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bar().getByText('1 submission selected')).toBeTruthy();
  });

  it('refuses a selection over the cap before sending, and says how many to deselect', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 201 }, (_, index) => summary(index + 1));
    const sent = await openList({}, many);
    await user.click(box('Select all on this page'));

    await user.click(bar().getByRole('button', { name: 'Assign owner' }));

    const dialog = await screen.findByRole('dialog', { name: 'Assign owner' });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'A change takes at most 200 submissions. Deselect 1 submission to continue.',
    );
    expect(sent.some(({ key }) => key === BULK || key === MEMBERS)).toBe(false);
  });
});

describe('details as submitted on a submission', () => {
  const record = {
    name: 'Harbourside Youth Project',
    legalForm: 'registered_charity' as const,
    registeredAddress: {
      line1: '1 High Street',
      line2: null,
      town: 'Leeds',
      postcode: 'LS1 1AA',
      countryCode: 'GB',
    },
    website: null,
    identifiers: [],
  };
  const snapshot = {
    ...record,
    id: uuid(800),
    organisationId: uuid(201),
    takenBy: uuid(11),
    takenAt: '2026-10-30T14:30:00.000Z',
  };

  async function openDetail(extra: Parameters<typeof detail>[0]) {
    const one = detail(extra);
    stubApi({
      ...listReads([summary(1)]),
      [api.one(one.id)]: ok(one),
      [api.files(one.id)]: ok({ attachments: [] }),
      [api.assignments(one.id)]: ok({ assignments: [] }),
    });
    openConsole(`/northfield/submissions/${one.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Harbourside Youth Project' });
  }

  it('shows the snapshot, and the link to the record when it has changed', async () => {
    await openDetail({
      organisationSnapshot: snapshot,
      currentOrganisation: { ...record, name: 'Harbourside CIO', href: '/crm/organisations/x' },
    });

    const panel = await screen.findByRole('region', { name: 'Organisation details as submitted' });
    expect(within(panel).getByText('1 High Street, Leeds, LS1 1AA')).toBeTruthy();
    expect(
      within(panel).getByRole('link', { name: 'See the current record' }).getAttribute('href'),
    ).toBe('/northfield/crm/organisations/x');
  });

  it('says so when an older submission has no snapshot', async () => {
    await openDetail({ organisationSnapshot: null });

    expect(
      await screen.findByText('Details as submitted were not recorded for this submission.'),
    ).toBeTruthy();
  });

  it('shows no panel while the server sends no snapshot field', async () => {
    await openDetail({});

    await screen.findByRole('tabpanel', { name: 'Application' });
    expect(screen.queryByRole('region', { name: 'Organisation details as submitted' })).toBeNull();
  });
});
