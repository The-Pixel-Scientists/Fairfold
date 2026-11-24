// SPDX-License-Identifier: AGPL-3.0-or-later

import { assureRoutes } from '@pixel-scientists/assure/contracts';
import { readRegistryKeys } from '@pixel-scientists/assure/server';
import { eventSubscribers } from '@pixel-scientists/domain/events';
import { describe, expect, it, vi } from 'vitest';

import { moduleDependencies } from '../modules.ts';
import { assureComposition, refreshQueue, screeningQueue } from './assure.ts';

/** Routes whose handlers are B15-07's: linking an officer, dismissing a flag, answers and visits. */
const unregistered = [
  'linkLookupOfficer',
  'dismissDuplicateFlag',
  'listApplicationChecklists',
  'getChecklistResponse',
  'saveChecklistResponse',
  'listVisits',
  'createVisit',
  'getVisit',
  'updateVisit',
] as const;

const composed = assureComposition(moduleDependencies({}));
const name = ({ method, path }: { method: string; path: string }) => `${method} ${path}`;

describe('the assure composition', () => {
  it('registers every assure route that has a handler, and no other', () => {
    const wanted = Object.entries(assureRoutes)
      .filter(([route]) => !(unregistered as readonly string[]).includes(route))
      .map(([, contract]) => name(contract));

    expect((composed.routes ?? []).map(({ contract }) => name(contract))).toEqual(wanted);
  });

  it('gives a replay reader to each idempotent route and to no other', () => {
    for (const { contract, replay } of composed.routes ?? []) {
      expect(replay !== undefined, name(contract)).toBe(
        'idempotent' in contract && contract.idempotent === true,
      );
    }
  });

  it('runs the refresh and screening queues and the submission subscriber, all per tenant', () => {
    expect((composed.jobs ?? []).map(({ queue }) => [queue.name, queue.kind])).toEqual([
      ['assure.registry_refresh', 'tenant'],
      ['assure.screening', 'tenant'],
      ['events.assure', 'tenant'],
    ]);
  });

  it('listens to the submission event', () => {
    expect(eventSubscribers('grants.application_submitted.v1')).toContain('assure');
  });

  it('contributes assure to erasure, and supplies nothing the platform does not read yet', () => {
    expect(composed.erasure?.map(({ module }) => module)).toEqual(['assure']);
    expect(composed.subjectData).toBeUndefined();
    expect(composed.repoints).toBeUndefined();
    expect(composed.subjectRules).toBeUndefined();
  });

  it('says which registers are not set up, by name, and sets up the one with a key', () => {
    const warn = vi.fn();
    assureComposition(moduleDependencies({ log: { warn } }));
    expect(warn).toHaveBeenCalledWith(
      { code: 'registers_off' },
      'Registers not set up: charity_commission, companies_house, oscr, ccni.',
    );

    const keyed = vi.fn();
    assureComposition(
      moduleDependencies({
        log: { warn: keyed },
        settings: {
          crm: undefined,
          marketing: undefined,
          forms: undefined,
          assure: {
            registryKeys: readRegistryKeys({ TPS_CHARITY_COMMISSION_API_KEY: 'k'.repeat(20) }),
            sanctionsListUrl: undefined,
          },
        },
      }),
    );
    expect(keyed).toHaveBeenCalledWith(
      { code: 'registers_off' },
      'Registers not set up: companies_house, oscr, ccni.',
    );
  });
});

describe('the assure queues', () => {
  const id = '0b9f3c1e-5d2a-4b7e-9c1f-2a3b4c5d6e7f';

  it('take ids and codes only, and refuse a tenant, a name or a stray key', () => {
    expect(
      refreshQueue.data.safeParse({ organisationId: id, registry: 'charity_commission' }).success,
    ).toBe(true);
    expect(refreshQueue.data.safeParse({ slot: id }).success).toBe(true);
    expect(refreshQueue.data.safeParse({ organisationId: id, name: 'Quillfeather' }).success).toBe(
      false,
    );
    expect(refreshQueue.data.safeParse({ registry: 'nope' }).success).toBe(false);
    expect(screeningQueue.data.safeParse({ runId: id }).success).toBe(true);
    expect(screeningQueue.data.safeParse({ runId: id, partyName: 'Quillfeather' }).success).toBe(
      false,
    );
  });
});
