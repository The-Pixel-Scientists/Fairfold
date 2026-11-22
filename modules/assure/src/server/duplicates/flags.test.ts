// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags over stand-ins for party's and grants' answers: the signal
// each of party's raises, that a flag holds ids and a signal only, and that
// asking only reads.

import { createHash, randomUUID } from 'node:crypto';

import type { DuplicateSignal } from '@pixel-scientists/party/contracts';
import { describe, expect, it, vi } from 'vitest';

import { duplicateHandlers, flagId as flagIdWith, type DuplicateContext } from './index.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const flagId = (...parts: string[]) => flagIdWith(digest, ...parts);
const NOW = new Date('2026-12-01T10:00:00Z');
const [organisation, applicant, other] = [randomUUID(), randomUUID(), randomUUID()];
const application = randomUUID();

function handlersFor(signals: readonly DuplicateSignal[]) {
  const duplicateCandidates = vi.fn((_request: unknown, partyId: string) =>
    Promise.resolve(partyId === organisation ? [{ partyId: other, signals: [...signals] }] : []),
  );
  const handlers = duplicateHandlers({
    notFound: () => new Error('Not found'),
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
    now: () => NOW,
  });
  return { handlers, duplicateCandidates };
}

const context = {
  audit: { record: vi.fn(), read: vi.fn() },
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
        id: flagId(organisation, other, raised),
        partyId: organisation,
        otherPartyId: other,
        applicationId: application,
        otherApplicationId: null,
        signal: raised,
        raisedAt: NOW.toISOString(),
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
