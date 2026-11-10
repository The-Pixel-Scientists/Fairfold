// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Transaction } from '@pixel-scientists/db';
import type { ModuleId } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { runErasure, type Contribution } from './registry.ts';
import { countsAsChanges, countsFromChanges } from './status.ts';

const tx = {} as Transaction<unknown>;
const subjects = [
  { partyId: crypto.randomUUID(), givenName: null, familyName: null, email: null, accountId: null },
];

const contribution = (module: ModuleId, answer: unknown, calls: string[] = []): Contribution => ({
  module,
  erase: () => {
    calls.push(module);
    return Promise.resolve(answer as Record<string, number>);
  },
});

describe('runErasure', () => {
  it('runs party first, then the rest in registration order, and adds their counts', async () => {
    const calls: string[] = [];
    const counts = await runErasure(
      tx,
      [
        contribution('grants', { 'grants.application': 2 }, calls),
        contribution('crm', { 'crm.note': 1 }, calls),
        contribution('party', { 'party.person': 1, 'party.party': 1 }, calls),
      ],
      subjects,
    );

    expect(calls).toEqual(['party', 'grants', 'crm']);
    expect(counts).toEqual({
      'party.person': 1,
      'party.party': 1,
      'grants.application': 2,
      'crm.note': 1,
    });
  });

  it.each([
    ['a value instead of counts', { 'party.person': 'ada@example.org' }],
    ['a negative count', { 'party.person': -1 }],
    ['a key that is no table', { 'ada@example.org': 1 }],
    ['nothing', undefined],
  ])('fails the whole erasure for %s, without repeating it', async (_name, answer) => {
    const failure = await runErasure(tx, [contribution('party', answer)], subjects).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The party module's erasure result is not valid.");
  });

  it('fails when a contribution throws, and does not run the ones after it', async () => {
    const calls: string[] = [];
    const broken: Contribution = {
      module: 'party',
      erase: () => Promise.reject(new Error('The database refused.')),
    };

    await expect(
      runErasure(tx, [broken, contribution('grants', {}, calls)], subjects),
    ).rejects.toThrow('The database refused.');
    expect(calls).toEqual([]);
  });

  it('refuses two contributions for one module', async () => {
    await expect(
      runErasure(tx, [contribution('party', {}), contribution('party', {})], subjects),
    ).rejects.toThrow('A module has more than one erasure contribution.');
  });
});

describe('counts in an audit event', () => {
  it('round-trips counts by table through the event’s changes', () => {
    const counts = { 'party.person': 1, 'grants.application': 0 };

    expect(countsAsChanges(counts)).toEqual({
      'party.person.id': { after: 1 },
      'grants.application.id': { after: 0 },
    });
    expect(countsFromChanges(countsAsChanges(counts))).toEqual(counts);
  });

  it('reads no counts from changes that are not counts', () => {
    expect(countsFromChanges(null)).toBeNull();
    expect(countsFromChanges({ 'party.person.id': { after: 'Ada' } })).toBeNull();
    expect(countsFromChanges({ 'app.job_request.failure_code': { after: 'internal' } })).toEqual(
      {},
    );
  });
});
