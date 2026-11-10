// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Transaction } from '@pixel-scientists/db';
import { describe, expect, it } from 'vitest';

import { collectModuleData, type Contribution } from './registry.ts';

const tx = {} as Transaction<unknown>;
const partyId = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const row = { 'party.party.id': { value: partyId, sensitivity: 'internal' as const } };

describe('collectModuleData', () => {
  it('runs every contribution with the subject and no tenant', async () => {
    const seen: unknown[][] = [];
    const contribution = (module: 'party' | 'grants'): Contribution => ({
      module,
      subjectData: (...args) => {
        seen.push(args.slice(1));
        return Promise.resolve({ [`${module}.thing`]: [] });
      },
    });
    const data = await collectModuleData(
      tx,
      [contribution('party'), contribution('grants')],
      [partyId],
    );
    expect(Object.keys(data)).toEqual(['party', 'grants']);
    expect(seen).toEqual([[partyId], [partyId]]);
  });

  it('runs each contribution for every party of a merge set and joins their rows by table', async () => {
    const duplicate = '9d2c4b7e-1a3f-4c58-8e60-7f1b2a3c4d5e';
    const merged: Contribution = {
      module: 'party',
      subjectData: (_tx, id) =>
        Promise.resolve({
          'party.party': [{ 'party.party.id': { value: id, sensitivity: 'internal' } }],
        }),
    };
    const data = await collectModuleData(tx, [merged], [partyId, duplicate]);
    expect(data.party?.['party.party']?.map((r) => r['party.party.id']?.value)).toEqual([
      partyId,
      duplicate,
    ]);
  });

  it('refuses two contributions for one module', async () => {
    const same: Contribution = { module: 'party', subjectData: () => Promise.resolve({}) };
    await expect(collectModuleData(tx, [same, same], [partyId])).rejects.toThrow(
      'more than one subject data contribution',
    );
  });

  it('fails on a shape the schema refuses, without repeating the value', async () => {
    const bad: Contribution = {
      module: 'party',
      subjectData: () =>
        Promise.resolve({
          'party.person': [{ 'party.person.email': { value: 'ada@example.org' } }],
        }) as never,
    };
    const error = await collectModuleData(tx, [bad], [partyId]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('ada@example.org');
  });

  it('refuses a column the map does not list or lists with another sensitivity', async () => {
    const cells: Record<string, { value: string; sensitivity: 'public' | 'internal' }>[] = [
      { 'party.person.nickname': { value: 'Ada', sensitivity: 'public' } },
      { 'party.person.email': { value: 'a@example.org', sensitivity: 'public' } },
      { 'party.nothing.id': { value: partyId, sensitivity: 'internal' } },
    ];
    for (const cell of cells) {
      const drifted: Contribution = {
        module: 'party',
        subjectData: () => Promise.resolve({ 'party.person': [cell] }),
      };
      await expect(collectModuleData(tx, [drifted], [partyId])).rejects.toThrow('not valid');
    }
  });

  it('keeps a valid answer as it came', async () => {
    const good: Contribution = {
      module: 'party',
      subjectData: () => Promise.resolve({ 'party.party': [row] }),
    };
    expect(await collectModuleData(tx, [good], [partyId])).toEqual({
      party: { 'party.party': [row] },
    });
  });
});
