// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's contribution to the shared warehouse (ADR 0016): every
// organisation and every person, read in the caller's transaction. A person
// has no name or contact detail here, and the platform's classification
// filter drops any column whose source is not public or internal.

import type { WarehouseContribution } from '@pixel-scientists/domain/warehouse';

import { identifierSchemeIds } from '../contracts/index.ts';
import type { Tx } from './tables.ts';

/** The columns the warehouse reads (migration 0005). */
type WarehouseSources = {
  'party.party': { id: string; status: string };
  'party.organisation': {
    id: string;
    name: string;
    legal_form: string;
    website: string | null;
    created_at: Date;
  };
  'party.organisation_identifier': {
    organisation_id: string;
    scheme: string;
    identifier: string;
    verified_at: Date | null;
  };
  'party.person': { id: string; created_at: Date };
};

/** Earlier in the list is preferred, as org-id.guide's scheme order in the contracts. */
const schemeRank = (scheme: string): number =>
  identifierSchemeIds.findIndex((candidate) => candidate === scheme);

export const partyWarehouse: WarehouseContribution<'party', Tx> = {
  module: 'party',
  tables: {
    async organisation(tx) {
      const db = tx.$extendTables<WarehouseSources>();
      const organisations = await db
        .selectFrom('party.organisation as o')
        .innerJoin('party.party as p', 'p.id', 'o.id')
        .select(['o.id', 'p.status', 'o.name', 'o.legal_form', 'o.website', 'o.created_at'])
        .orderBy('o.created_at')
        .orderBy('o.id')
        .execute();
      const identifiers = await db
        .selectFrom('party.organisation_identifier')
        .select(['organisation_id', 'scheme', 'identifier', 'verified_at'])
        .execute();
      const first = new Map<string, (typeof identifiers)[number]>();
      for (const item of identifiers) {
        const held = first.get(item.organisation_id);
        if (held === undefined || schemeRank(item.scheme) < schemeRank(held.scheme)) {
          first.set(item.organisation_id, item);
        }
      }
      return organisations.map((row) => {
        const item = first.get(row.id);
        return {
          id: row.id,
          status: row.status,
          name: row.name,
          legal_form: row.legal_form,
          website: row.website,
          org_id: item === undefined ? null : `${item.scheme}-${item.identifier}`,
          org_id_verified: item === undefined ? null : item.verified_at !== null,
          created_at: row.created_at.toISOString(),
        };
      });
    },
    async person(tx) {
      const people = await tx
        .$extendTables<WarehouseSources>()
        .selectFrom('party.person as n')
        .innerJoin('party.party as p', 'p.id', 'n.id')
        .select(['n.id', 'p.status', 'n.created_at'])
        .orderBy('n.created_at')
        .orderBy('n.id')
        .execute();
      return people.map((row) => ({
        id: row.id,
        status: row.status,
        created_at: row.created_at.toISOString(),
      }));
    },
  },
};
