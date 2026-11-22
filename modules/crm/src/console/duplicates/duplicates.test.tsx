// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetNames } from '../labels.tsx';
import {
  id,
  open,
  organisationRecord,
  problem,
  refreshedSession,
  session,
  STEP_UP_NEEDED,
  stubFetch,
} from '../harness.test.tsx';

const ADA = id(1);
const BEN = id(2);
const TOKEN = `1700000000.${'a'.repeat(43)}`;

const pair = {
  partyId: ADA,
  otherPartyId: BEN,
  kind: 'organisation',
  signals: ['verified_identifier', 'name'],
  band: 'high',
};

const names = {
  [`GET /console/crm/organisations/${ADA}`]: {
    status: 200,
    body: organisationRecord('Riverside Trust'),
  },
  [`GET /console/crm/organisations/${BEN}`]: {
    status: 200,
    body: organisationRecord('Riverside Club'),
  },
};

const preview = {
  loserId: BEN,
  survivorId: ADA,
  kind: 'organisation',
  fields: [
    { fieldId: 'organisation.name', loser: 'Riverside Club', survivor: 'Riverside Trust' },
    { fieldId: 'organisation.website', loser: null, survivor: null },
  ],
  conflicts: [],
  counts: { grants: { 'grants.application': 3 }, crm: { 'crm.list_member': 2 } },
  linkRule: 'automatic',
  links: [],
  token: TOKEN,
};

const merge = {
  id: id(50),
  kind: 'merge',
  partyKind: 'organisation',
  loserId: BEN,
  survivorId: ADA,
  reverses: null,
  decidedAt: '2026-11-19T10:00:00.000Z',
  decidedBy: id(60),
  counts: preview.counts,
};

const reviewer = session(['crm.duplicates.review', 'crm.parties.merge']);
const comparePath = `/crm/duplicates/organisation/${ADA}/${BEN}`;

beforeEach(() => {
  forgetNames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('possible duplicates', () => {
  it('lists pairs with the reasons in words, and sends filters in the body only', async () => {
    const sent = stubFetch({
      ...names,
      'POST /console/crm/duplicates/query': {
        status: 200,
        body: { pairs: [pair], nextCursor: null },
      },
    });
    const user = userEvent.setup();
    open('/crm/duplicates', reviewer);

    expect(await screen.findByRole('link', { name: 'Riverside Trust' })).toBeTruthy();
    expect(screen.getByText('Strong match')).toBeTruthy();
    expect(screen.getByText('Same verified number, Similar name')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Compare records' }).getAttribute('href')).toBe(
      `/crm/duplicates/organisation/${ADA}/${BEN}`,
    );

    await user.selectOptions(screen.getByLabelText('Kind'), 'organisation');
    await waitFor(() => {
      expect(sent.at(-1)?.body).toEqual({ kind: 'organisation' });
    });
    expect(window.location.href).not.toContain('organisation?');
  });

  it('dismisses a pair with a reason and removes it, sending one idempotency key', async () => {
    const sent = stubFetch({
      ...names,
      'POST /console/crm/duplicates/query': {
        status: 200,
        body: { pairs: [pair], nextCursor: null },
      },
      'POST /console/crm/duplicate-dismissals': {
        status: 201,
        body: {
          id: id(70),
          partyId: ADA,
          otherPartyId: BEN,
          reason: 'different_organisation',
          dismissedAt: '2026-11-19T10:00:00.000Z',
        },
      },
    });
    const user = userEvent.setup();
    open('/crm/duplicates', reviewer);

    await user.click(await screen.findByRole('button', { name: 'Not a duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark as not duplicates' });
    await user.click(within(dialog).getByRole('button', { name: 'Mark as not duplicates' }));
    expect(
      within(dialog).getByText('Choose why these two records are not duplicates.'),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('radio', { name: 'They are different organisations' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mark as not duplicates' }));

    expect(await screen.findByText('No possible duplicates')).toBeTruthy();
    const posts = sent.filter(({ key }) => key.endsWith('duplicate-dismissals'));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      partyId: ADA,
      otherPartyId: BEN,
      reason: 'different_organisation',
    });
    expect(posts[0]?.headers['Idempotency-Key']).toBeTruthy();
  });

  it('shows the not-found page and makes no request to a member without the permission', async () => {
    const sent = stubFetch({});
    open('/crm/duplicates', session([]));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('shows the not-found page and makes no request while crm is off', async () => {
    const sent = stubFetch({});
    open('/crm/duplicates', session(['crm.duplicates.review'], { modules: [] }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toHaveLength(0);
  });
});

describe('compare and merge', () => {
  const previewKey = 'POST /console/crm/merges/preview';

  it('says exactly what moves, then merges with the preview token and no member or tenant id', async () => {
    let confirms = 0;
    const sent = stubFetch({
      ...names,
      [previewKey]: { status: 200, body: preview },
      'POST /console/crm/merges': () => {
        confirms += 1;
        return confirms === 1 ? problem(403, STEP_UP_NEEDED) : { status: 201, body: merge };
      },
      'POST /auth/step-up': {
        status: 200,
        body: refreshedSession(['crm.duplicates.review', 'crm.parties.merge']),
      },
    });
    const user = userEvent.setup();
    open(comparePath, reviewer);

    expect(await screen.findByRole('heading', { level: 1, name: 'Compare records' })).toBeTruthy();
    expect(await screen.findByText('Different')).toBeTruthy();
    expect(screen.getByText('Same')).toBeTruthy();
    expect(sent.find(({ key }) => key === previewKey)?.body).toEqual({
      loserId: BEN,
      survivorId: ADA,
      kind: 'organisation',
    });

    await user.click(screen.getByRole('button', { name: 'Review merge of organisations' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge organisations' });
    expect(dialog.textContent).toContain(
      '3 applications and 2 list memberships will move to Riverside Trust. Riverside Club will be marked as merged.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Merge organisations' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    await user.type(within(stepUp).getByLabelText('Password'), 'correct horse battery');
    await user.type(within(stepUp).getByLabelText('Code from your authenticator app'), '123456');
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm it is you' }));

    expect(await screen.findByText('The records are merged')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: 'The records are merged' }),
    );
    expect(screen.getByText(/The merge record is/).textContent).toContain(merge.id);
    const posts = sent.filter(({ key }) => key === 'POST /console/crm/merges');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toEqual({
      loserId: BEN,
      survivorId: ADA,
      kind: 'organisation',
      carryOver: [],
      token: TOKEN,
    });
    expect(JSON.stringify(posts[0]?.body)).not.toMatch(/tenant|member|actor/i);
    expect(posts[0]?.headers['Idempotency-Key']).toBe(posts[1]?.headers['Idempotency-Key']);
  });

  it('refuses a stale preview, says to compare again and reads the preview again', async () => {
    const sent = stubFetch({
      ...names,
      [previewKey]: { status: 200, body: preview },
      'POST /console/crm/merges': problem(409, 'Preview the merge again, then confirm it.'),
    });
    const user = userEvent.setup();
    open(comparePath, reviewer);

    await user.click(await screen.findByRole('button', { name: 'Review merge of organisations' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge organisations' });
    await user.click(within(dialog).getByRole('button', { name: 'Merge organisations' }));

    expect(await screen.findByText(/Compare the records again, then merge/)).toBeTruthy();
    await waitFor(() => {
      expect(sent.filter(({ key }) => key === previewKey)).toHaveLength(2);
    });
  });

  it('blocks the merge and says how to resolve a conflict', async () => {
    stubFetch({
      ...names,
      [previewKey]: { status: 200, body: { ...preview, conflicts: ['identifiers_both_verified'] } },
    });
    open(comparePath, reviewer);

    expect(await screen.findByText('These records cannot be merged yet')).toBeTruthy();
    expect(screen.getByText(/keep them as separate records/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Review merge/ })).toBeNull();
  });

  it('shows the not-found page to a member who may not merge, without a request', async () => {
    const sent = stubFetch({});
    open(comparePath, session(['crm.duplicates.review']));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(sent).toHaveLength(0);
  });
});
