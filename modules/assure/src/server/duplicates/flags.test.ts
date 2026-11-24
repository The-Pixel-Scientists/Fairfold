// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags over stand-ins for party's and grants' answers and for the
// store: the signal each of party's raises, that a flag holds ids and a signal
// only and has one id whichever party it is listed for, and that a dismissal
// needs a reason from the list, happens once and is audited with ids and a
// code. The store itself is tested through the API.

import { createHash, randomUUID } from 'node:crypto';

import type { DuplicateSignal } from '@pixel-scientists/party/contracts';
import { describe, expect, it, vi } from 'vitest';

import { duplicateHandlers, flagId as flagIdWith, type DuplicateContext } from './index.ts';
import * as store from './store.ts';

vi.mock('./store.ts', () => ({
  recordFlags: vi.fn((_tx: unknown, _member: string, keys: { id: string }[]) =>
    Promise.resolve(
      new Map(
        keys.map((key) => [
          key.id,
          { ...key, raisedAt: '2026-12-01T10:00:00.000Z', dismissal: null },
        ]),
      ),
    ),
  ),
  lockFlag: vi.fn(),
  dismiss: vi.fn(),
}));

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const flagId = (...parts: string[]) => flagIdWith(digest, ...parts);
const RAISED = '2026-12-01T10:00:00.000Z';
const [organisation, applicant, other] = [randomUUID(), randomUUID(), randomUUID()];
/** The id of a flag between two parties, which is derived from them in a fixed order. */
const idBetween = (one: string, two: string, signal: string) =>
  one < two ? flagId(one, two, signal) : flagId(two, one, signal);
const application = randomUUID();

function handlersFor(signals: readonly DuplicateSignal[]) {
  const duplicateCandidates = vi.fn((_request: unknown, partyId: string) =>
    Promise.resolve(partyId === organisation ? [{ partyId: other, signals: [...signals] }] : []),
  );
  const handlers = duplicateHandlers({
    notFound: () => new Error('Not found'),
    refuse: (_status, detail) => new Error(detail),
    parties: {
      duplicateCandidates,
      resolveParty: (_request, id) =>
        Promise.resolve(
          id === organisation ? { id, kind: 'organisation', reachedThroughMerge: false } : null,
        ),
    },
    readApplicant: (_tx, id) =>
      Promise.resolve(
        id === application ? { organisationId: organisation, applicantPersonId: applicant } : null,
      ),
    digest,
  });
  return { handlers, duplicateCandidates };
}

const record = vi.fn();
const context = {
  audit: { record, read: vi.fn() },
  membership: { id: randomUUID() },
} as unknown as DuplicateContext;
const tx = {} as never;

describe('the signals', () => {
  it.each([
    ['verified_identifier', 'shared_identifier'],
    ['name', 'similar_name'],
    ['name_and_postcode', 'similar_name'],
    ['name_and_organisation', 'similar_name'],
    ['email', 'shared_contact_point'],
  ] as const)('%s raises %s', async (signal, raised) => {
    const { handlers } = handlersFor([signal]);
    const { flags } = await handlers.listApplicationDuplicateFlags({
      tx,
      context,
      input: { params: { applicationId: application } },
    });
    expect(flags).toEqual([
      {
        id: idBetween(organisation, other, raised),
        partyId: organisation,
        otherPartyId: other,
        applicationId: application,
        otherApplicationId: null,
        signal: raised,
        raisedAt: RAISED,
        dismissal: null,
      },
    ]);
  });

  it('raises nothing for a claimed identifier, and one flag for two signals that agree', async () => {
    const claimed = handlersFor(['claimed_identifier']).handlers;
    const params = { partyId: organisation };
    expect(
      (await claimed.listPartyDuplicateFlags({ tx, context, input: { params } })).flags,
    ).toEqual([]);
    const both = handlersFor(['name', 'name_and_postcode']).handlers;
    expect(
      (await both.listPartyDuplicateFlags({ tx, context, input: { params } })).flags,
    ).toHaveLength(1);
  });
});

describe('the flag id', () => {
  it('is a stable UUID for the same parties and signal, and differs for another', () => {
    const id = flagId(organisation, other, 'similar_name');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(flagId(organisation, other, 'similar_name')).toBe(id);
    expect(flagId(organisation, other, 'shared_identifier')).not.toBe(id);
    expect(flagId(other, organisation, 'similar_name')).not.toBe(id);
  });
});

describe('a missing party or application', () => {
  it('answers as a missing record does, and asks party nothing for an unknown application', async () => {
    const { handlers, duplicateCandidates } = handlersFor(['name']);
    const missing = await handlers
      .listApplicationDuplicateFlags({
        tx,
        context,
        input: { params: { applicationId: randomUUID() } },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(missing).toEqual(new Error('Not found'));
    const party = await handlers
      .listPartyDuplicateFlags({ tx, context, input: { params: { partyId: randomUUID() } } })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(party).toEqual(new Error('Not found'));
    expect(duplicateCandidates).not.toHaveBeenCalled();
  });
});

describe('dismissing a flag', () => {
  const flag = randomUUID();
  const stored = {
    id: flag,
    partyId: organisation,
    otherPartyId: other,
    signal: 'similar_name' as const,
    raisedAt: RAISED,
    dismissal: null,
  };
  const dismissed = {
    ...stored,
    dismissal: {
      reason: 'different_person' as const,
      dismissedAt: RAISED,
      dismissedBy: context.membership.id,
    },
  };
  const dismissWith = (body: unknown, id: string = flag) =>
    handlersFor(['name']).handlers.dismissDuplicateFlag({
      tx,
      context,
      input: { params: { flagId: id }, body },
    });
  const failure = (work: Promise<unknown>) =>
    work.then(
      () => undefined,
      (error: unknown) => error,
    );

  it('records the reason against the member in the session, and audits ids and a code only', async () => {
    vi.mocked(store.lockFlag).mockResolvedValueOnce(stored);
    vi.mocked(store.dismiss).mockResolvedValueOnce(dismissed);
    const answer = await dismissWith({ reason: 'different_person' });

    expect(store.dismiss).toHaveBeenCalledWith(tx, flag, 'different_person', context.membership.id);
    expect(answer).toMatchObject({ id: flag, applicationId: null, dismissal: dismissed.dismissal });
    expect(record).toHaveBeenCalledWith({
      action: 'assure.duplicate_flag.dismissed',
      entityId: flag,
      subjectPartyId: organisation,
      changes: { 'assure.duplicate_flag.dismiss_reason': { after: 'different_person' } },
    });
  });

  it('refuses a reason outside the list, a member named in the body and an unknown or malformed id', async () => {
    vi.mocked(store.dismiss).mockClear();
    expect(await failure(dismissWith({ reason: 'tidy' }))).toEqual(
      new Error('Choose a reason from the list.'),
    );
    expect(
      await failure(dismissWith({ reason: 'different_person', dismissedBy: randomUUID() })),
    ).toEqual(new Error('Choose a reason from the list.'));
    vi.mocked(store.lockFlag).mockResolvedValueOnce(undefined);
    expect(await failure(dismissWith({ reason: 'different_person' }))).toEqual(
      new Error('Not found'),
    );
    expect(await failure(dismissWith({ reason: 'different_person' }, 'nope'))).toEqual(
      new Error('Not found'),
    );
    expect(store.dismiss).not.toHaveBeenCalled();
  });

  it('answers 409 for a flag that is already dismissed, and changes nothing', async () => {
    vi.mocked(store.lockFlag).mockResolvedValueOnce(dismissed);
    expect(await failure(dismissWith({ reason: 'different_person' }))).toEqual(
      new Error('This flag has already been dismissed.'),
    );
    expect(store.dismiss).not.toHaveBeenCalled();
  });
});
