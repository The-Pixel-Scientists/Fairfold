// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { id, open, session, stubFetch } from '../harness.test.tsx';

const VISIT = id(5);
const ORGANISATION = id(1);
const stamp = '2026-12-01T10:00:00.000Z';

const record = {
  id: VISIT,
  organisationId: ORGANISATION,
  applicationId: null,
  visitedOn: '2026-11-30',
  type: 'in_person',
};
const summary = { ...record, openFollowUps: 2 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('visit list', () => {
  it('stacks visits with their open follow-ups in words', async () => {
    stubFetch({
      'GET /console/visits': { status: 200, body: { visits: [summary], nextCursor: null } },
    });
    open('/assure/visits');
    expect(await screen.findByRole('link', { name: '30 November 2026, in person' })).toBeTruthy();
    expect(screen.getByText('2 open follow-ups')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('tells a member with no visits how to record one', async () => {
    stubFetch({ 'GET /console/visits': { status: 200, body: { visits: [], nextCursor: null } } });
    open('/assure/visits');
    expect(await screen.findByText('No visits recorded yet')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Record a visit' }).length).toBeGreaterThan(0);
  });
});

describe('visit form', () => {
  it('records a visit with a chosen organisation and sends no member or tenant', async () => {
    const user = userEvent.setup();
    const sent = stubFetch({
      'POST /console/search': {
        status: 200,
        body: {
          audience: 'staff',
          groups: [
            {
              module: 'crm',
              more: false,
              results: [
                { kind: 'crm.organisation', id: ORGANISATION, label: 'Riverside Lunch Club' },
              ],
            },
          ],
        },
      },
      'POST /console/visits': {
        status: 201,
        body: {
          ...record,
          attendeePersonIds: [],
          findings: 'Records in order.',
          followUps: [],
          evidence: [],
          recordedAt: stamp,
          updatedAt: stamp,
        },
      },
    });
    open('/assure/visits/new');

    await user.type(await screen.findByRole('combobox', { name: /Organisation/ }), 'Riverside');
    await user.click(await screen.findByRole('option', { name: /Riverside Lunch Club/ }));
    await user.type(screen.getByLabelText('Day'), '30');
    await user.type(screen.getByLabelText('Month'), '11');
    await user.type(screen.getByLabelText('Year'), '2026');
    await user.click(screen.getByLabelText('In person'));
    await user.type(screen.getByRole('textbox', { name: /^Findings/ }), 'Records in order.');
    await user.click(screen.getByRole('button', { name: 'Record visit' }));

    expect(await screen.findByText('Visit recorded')).toBeTruthy();
    const body = sent.find(({ key }) => key === 'POST /console/visits')?.body;
    expect(body).toEqual({
      organisationId: ORGANISATION,
      applicationId: null,
      visitedOn: '2026-11-30',
      type: 'in_person',
      attendeePersonIds: [],
      findings: 'Records in order.',
      followUps: [],
      evidence: [],
    });
  });

  it('links to the field when the type is missing', async () => {
    const user = userEvent.setup();
    stubFetch({});
    open('/assure/visits/new');
    await user.click(await screen.findByRole('button', { name: 'Record visit' }));
    expect(
      await screen.findByRole('link', { name: /Choose how the visit took place/ }),
    ).toBeTruthy();
  });

  it('shows not found without the visits permission', async () => {
    const sent = stubFetch({});
    open('/assure/visits/new', session(['assure.checklists.manage']));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Record visit' })).toBeNull();
    expect(sent).toEqual([]);
  });
});
