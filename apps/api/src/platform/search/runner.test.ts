// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The search fan-out with stand-in providers: the module switch, permissions,
// the module filter, caps, audience, the response check and the person audit.

import type { Permission } from '@pixel-scientists/domain/platform';
import {
  defineSearchProvider,
  normaliseSearchTerm,
  SEARCH_GROUP_LIMIT,
  type SearchFunction,
  type SearchHit,
  type SearchRequest,
  type SearchTerm,
} from '@pixel-scientists/domain/platform/search';
// Loading party's contracts defines its audit actions, which a read action must come from.
import '@pixel-scientists/party/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RequestAudit } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';
import { runSearch, SEARCH_TOTAL_LIMIT, type SearchEntry } from './runner.ts';

const term = normaliseSearchTerm('Zelda Quillfeather') as SearchTerm;

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const staff = ['staff'] as const;
const reviewers = ['reviewer', 'blind_reviewer'] as const;

const organisations = defineSearchProvider({
  module: 'party',
  kind: 'party.organisation',
  permission: 'party.records.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [{ id: 'name', sensitivity: 'internal', audiences: staff }],
  label: 'internal',
});

const people = defineSearchProvider({
  module: 'party',
  kind: 'party.person',
  permission: 'party.records.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [{ id: 'email', sensitivity: 'personal', audiences: staff }],
  label: 'personal',
  readAction: 'party.person.viewed',
});

const staffApplications = defineSearchProvider({
  module: 'grants',
  kind: 'grants.application',
  permission: 'grants.applications.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [{ id: 'reference', sensitivity: 'internal', audiences: staff }],
  label: 'internal',
});

const reviewApplications = defineSearchProvider({
  module: 'grants',
  kind: 'grants.application',
  permission: 'grants.reviews.score',
  scopes: ['assigned_review'],
  audiences: reviewers,
  fields: [{ id: 'reference', sensitivity: 'internal', audiences: reviewers }],
  label: 'internal',
});

const crmContacts = defineSearchProvider({
  module: 'crm',
  kind: 'crm.contact',
  permission: 'crm.records.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [{ id: 'name', sensitivity: 'internal', audiences: staff }],
  label: 'internal',
});

type Made = SearchHit['kind'];

const hits = (
  kind: Made,
  module: SearchHit['module'],
  count: number,
  label = 'Match',
): SearchHit[] =>
  Array.from({ length: count }, (_, n) => ({
    kind,
    id: ID(n + 1),
    label: `${label} ${n + 1}`,
    module,
  }));

/** A provider's search that records what it was asked, and answers `answer`. */
function entry(provider: SearchEntry['provider'], answer: readonly SearchHit[]) {
  const asked: SearchRequest[] = [];
  const search = vi.fn<(tx: TenantTransaction) => SearchFunction>(() => (request) => {
    asked.push(request);
    return Promise.resolve(answer);
  });
  return { entry: { provider, search } satisfies SearchEntry, asked, search };
}

/** A transaction that holds the tenant's module switches. */
const txWith = (rows: { module: string; enabled: boolean }[]) =>
  ({
    $extendTables: () => ({
      selectFrom: () => ({ select: () => ({ execute: () => Promise.resolve(rows) }) }),
    }),
  }) as unknown as TenantTransaction;

const grantsOn = [{ module: 'grants', enabled: true }];

function auditLog() {
  const read = vi.fn<RequestAudit['read']>(() => Promise.resolve());
  return { read, audit: { read, record: vi.fn() } as RequestAudit };
}

const holding = (...held: Permission[]) => new Set<Permission>(held);

describe('runSearch', () => {
  it('calls only providers whose module is on, and never the one switched off', async () => {
    const party = entry(organisations, hits('party.organisation', 'party', 1));
    const grants = entry(staffApplications, hits('grants.application', 'grants', 1));
    const crm = entry(crmContacts, hits('crm.contact', 'crm', 1));
    const { audit } = auditLog();

    const answer = await runSearch({
      tx: txWith([{ module: 'crm', enabled: false }, ...grantsOn]),
      permissions: holding('party.records.read', 'grants.applications.read', 'crm.records.read'),
      audit,
      term,
      entries: [party.entry, grants.entry, crm.entry],
    });

    expect(answer.groups.map((group) => group.module)).toEqual(['party', 'grants']);
    expect(crm.search).not.toHaveBeenCalled();
  });

  it('treats a tool with no row as off', async () => {
    const grants = entry(staffApplications, hits('grants.application', 'grants', 1));
    const answer = await runSearch({
      tx: txWith([]),
      permissions: holding('grants.applications.read'),
      audit: auditLog().audit,
      term,
      entries: [grants.entry],
    });
    expect(answer.groups).toEqual([]);
    expect(grants.search).not.toHaveBeenCalled();
  });

  it('skips a provider whose permission the caller lacks', async () => {
    const party = entry(organisations, hits('party.organisation', 'party', 1));
    const grants = entry(staffApplications, hits('grants.application', 'grants', 1));
    const answer = await runSearch({
      tx: txWith(grantsOn),
      permissions: holding('party.records.read'),
      audit: auditLog().audit,
      term,
      entries: [party.entry, grants.entry],
    });
    expect(answer.groups.map((group) => group.module)).toEqual(['party']);
    expect(grants.search).not.toHaveBeenCalled();
  });

  it('narrows to the modules named, and says nothing of one that is off or not permitted', async () => {
    const party = entry(organisations, hits('party.organisation', 'party', 1));
    const grants = entry(staffApplications, hits('grants.application', 'grants', 1));
    const run = (modules: ('party' | 'grants' | 'crm')[]) =>
      runSearch({
        tx: txWith([]),
        permissions: holding('party.records.read', 'grants.applications.read'),
        audit: auditLog().audit,
        term,
        modules,
        entries: [party.entry, grants.entry],
      });
    expect((await run(['party'])).groups.map((group) => group.module)).toEqual(['party']);
    expect((await run(['grants', 'crm'])).groups).toEqual([]);
    expect(grants.search).not.toHaveBeenCalled();
  });

  it('gives a provider the term, the audience and a limit, nothing else, one provider at a time', async () => {
    const order: string[] = [];
    let busy = false;
    const slow = (provider: SearchEntry['provider'], kind: Made, module: SearchHit['module']) =>
      ({
        provider,
        search: () => async () => {
          expect(busy).toBe(false);
          busy = true;
          order.push(kind);
          await Promise.resolve();
          busy = false;
          return hits(kind, module, 1);
        },
      }) satisfies SearchEntry;
    const party = entry(organisations, []);
    await runSearch({
      tx: txWith(grantsOn),
      permissions: holding('party.records.read', 'grants.applications.read'),
      audit: auditLog().audit,
      term,
      entries: [
        slow(organisations, 'party.organisation', 'party'),
        slow(staffApplications, 'grants.application', 'grants'),
        party.entry,
      ],
    });
    expect(order).toEqual(['party.organisation', 'grants.application']);
    expect(party.asked).toEqual([{ term, audience: 'staff', limit: SEARCH_GROUP_LIMIT + 1 }]);
  });

  it('cuts a group at the cap and says there is more', async () => {
    const party = entry(organisations, hits('party.organisation', 'party', SEARCH_GROUP_LIMIT + 1));
    const answer = await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit: auditLog().audit,
      term,
      entries: [party.entry],
    });
    expect(answer.groups[0]?.results).toHaveLength(SEARCH_GROUP_LIMIT);
    expect(answer.groups[0]?.more).toBe(true);
  });

  it('does not say there is more when the group is full and no further result matched', async () => {
    const party = entry(organisations, hits('party.organisation', 'party', SEARCH_GROUP_LIMIT));
    const answer = await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit: auditLog().audit,
      term,
      entries: [party.entry],
    });
    expect(answer.groups[0]?.more).toBe(false);
  });

  it('shares a group between a module’s providers, one kind and then the other', async () => {
    const orgs = entry(organisations, hits('party.organisation', 'party', 3, 'Org'));
    const ppl = entry(people, hits('party.person', 'party', 3, 'Person'));
    const answer = await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit: auditLog().audit,
      term,
      entries: [orgs.entry, ppl.entry],
    });
    expect(answer.groups[0]?.results.map((result) => result.kind)).toEqual([
      'party.organisation',
      'party.person',
      'party.organisation',
      'party.person',
      'party.organisation',
      'party.person',
    ]);
  });

  it('cuts the whole answer at the overall cap', async () => {
    const providers = [
      entry(organisations, hits('party.organisation', 'party', SEARCH_GROUP_LIMIT + 1)),
      entry(staffApplications, hits('grants.application', 'grants', SEARCH_GROUP_LIMIT + 1)),
      entry(crmContacts, hits('crm.contact', 'crm', SEARCH_GROUP_LIMIT + 1)),
    ];
    const extra = entry(
      defineSearchProvider({
        ...crmContacts,
        module: 'assure',
        kind: 'assure.lookup',
        permission: 'assure.lookup.read',
      }),
      hits('assure.lookup', 'assure', SEARCH_GROUP_LIMIT + 1),
    );
    const answer = await runSearch({
      tx: txWith([
        ...grantsOn,
        { module: 'crm', enabled: true },
        { module: 'assure', enabled: true },
      ]),
      permissions: holding(
        'party.records.read',
        'grants.applications.read',
        'crm.records.read',
        'assure.lookup.read',
      ),
      audit: auditLog().audit,
      term,
      entries: [...providers.map(({ entry: made }) => made), extra.entry],
    });
    const total = answer.groups.reduce((sum, group) => sum + group.results.length, 0);
    expect(total).toBe(SEARCH_TOTAL_LIMIT);
    expect(answer.groups.at(-1)).toMatchObject({ module: 'assure', results: [], more: true });
  });

  it('answers a caller who holds only a reviewer provider as a blind reviewer, with the reference alone', async () => {
    const labelled = entry(reviewApplications, [
      { kind: 'grants.application', id: ID(1), label: 'GR-0001', module: 'grants' },
    ]);
    const answer = await runSearch({
      tx: txWith(grantsOn),
      permissions: holding('grants.reviews.score'),
      audit: auditLog().audit,
      term,
      entries: [labelled.entry],
    });
    expect(answer).toEqual({
      audience: 'blind_reviewer',
      groups: [
        {
          module: 'grants',
          results: [{ kind: 'grants.application', id: ID(1), reference: 'GR-0001' }],
          more: false,
        },
      ],
    });
    expect(labelled.asked[0]?.audience).toBe('blind_reviewer');
  });

  it('refuses a provider that returns a name to a blind reviewer, rather than filtering it', async () => {
    const leaky = entry(reviewApplications, [
      { kind: 'grants.application', id: ID(1), label: 'Quillfeather Trust', module: 'grants' },
    ]);
    const { audit, read } = auditLog();
    await expect(
      runSearch({
        tx: txWith(grantsOn),
        permissions: holding('grants.reviews.score'),
        audit,
        term,
        entries: [leaky.entry],
      }),
    ).rejects.toThrow('A search provider returned a result its audience may not see.');
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a result of another kind or module than its provider', async () => {
    const wrong = entry(organisations, hits('party.person', 'party', 1));
    await expect(
      runSearch({
        tx: txWith([]),
        permissions: holding('party.records.read'),
        audit: auditLog().audit,
        term,
        entries: [wrong.entry],
      }),
    ).rejects.toThrow('may not see');
  });

  it('audits each person result by id with the provider’s read action, and nothing else', async () => {
    const orgs = entry(organisations, hits('party.organisation', 'party', 2, 'Org'));
    const ppl = entry(people, hits('party.person', 'party', 2, 'Person'));
    const { audit, read } = auditLog();
    await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit,
      term,
      entries: [orgs.entry, ppl.entry],
    });
    expect(read.mock.calls.map(([event]) => event)).toEqual([
      { action: 'party.person.viewed', entityId: ID(1) },
      { action: 'party.person.viewed', entityId: ID(2) },
    ]);
    expect(JSON.stringify(read.mock.calls)).not.toContain('Zelda');
  });

  it('audits only the results it returns', async () => {
    const ppl = entry(people, hits('party.person', 'party', SEARCH_GROUP_LIMIT + 1));
    const { audit, read } = auditLog();
    await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit,
      term,
      entries: [ppl.entry],
    });
    expect(read).toHaveBeenCalledTimes(SEARCH_GROUP_LIMIT);
  });

  it('has no group, and writes no audit event, when nothing matched', async () => {
    const ppl = entry(people, []);
    const { audit, read } = auditLog();
    const answer = await runSearch({
      tx: txWith([]),
      permissions: holding('party.records.read'),
      audit,
      term,
      entries: [ppl.entry],
    });
    expect(answer).toEqual({ audience: 'staff', groups: [] });
    expect(read).not.toHaveBeenCalled();
  });
});
