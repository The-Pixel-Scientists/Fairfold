// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party the module's audit events are about (ADR 0027). The platform
// calls the rule of an event's action in the request's tenant transaction,
// so row-level security applies: a record in another tenant finds nothing,
// and an event that needs a subject and has none is refused. A subject is an
// id from a record in the database, never a value from the request. A person
// and an organisation share their party's id.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';

import type { PartyAuditAction } from '../contracts/index.ts';
import { partyDb, type Tx } from './tables.ts';

/** How an action finds its subject, or why it has none. */
export type SubjectRule =
  | {
      readonly subject: (
        tx: Transaction<unknown>,
        event: { readonly entityId: string; readonly changes?: AuditChanges },
      ) => Promise<string | null>;
    }
  | { readonly none: string };

/** The entity is a party: the person or organisation the event is about. */
const entityIsParty: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await partyDb(tx)
        .selectFrom('party.party')
        .select('id')
        .where('id', '=', entityId)
        .executeTakeFirst()
    )?.id ?? null,
};

/** The relationship's person, such as an organisation's contact. Relationships are never deleted. */
const relationship: SubjectRule = {
  subject: async (tx, { entityId }) =>
    (
      await partyDb(tx)
        .selectFrom('party.relationship')
        .select('subject_id')
        .where('id', '=', entityId)
        .executeTakeFirst()
    )?.subject_id ?? null,
};

/** Party tables the module's typed map does not list yet. */
type LaterTables = {
  'party.organisation_snapshot': { id: string; organisation_id: string };
  'party.suppression': { id: string; person_id: string };
};

const laterDb = (tx: Tx) => tx.$extendTables<LaterTables>();

export const partySubjectRules: Readonly<Record<PartyAuditAction, SubjectRule>> = {
  'party.person.created': entityIsParty,
  'party.person.updated': entityIsParty,
  'party.person.viewed': entityIsParty,
  'party.organisation.created': entityIsParty,
  'party.organisation.updated': entityIsParty,
  'party.organisation.viewed': entityIsParty,
  'party.relationship.created': relationship,
  'party.relationship.ended': relationship,
  // An identifier event's entity is its organisation, with the identifier id
  // in the changes, so a removed identifier still finds its subject.
  'party.identifier.added': entityIsParty,
  'party.identifier.removed': entityIsParty,
  'party.identifier.verified': entityIsParty,
  // The loser of a merge, and the erased party: both rows are kept.
  'party.party.merged': entityIsParty,
  'party.party.erased': entityIsParty,
  // The party whose history was read.
  'party.value_history.viewed': entityIsParty,
  'party.organisation_snapshot.created': {
    subject: async (tx, { entityId }) =>
      (
        await laterDb(tx)
          .selectFrom('party.organisation_snapshot')
          .select('organisation_id')
          .where('id', '=', entityId)
          .executeTakeFirst()
      )?.organisation_id ?? null,
  },
  'party.suppression.added': {
    subject: async (tx, { entityId }) =>
      (
        await laterDb(tx)
          .selectFrom('party.suppression')
          .select('person_id')
          .where('id', '=', entityId)
          .executeTakeFirst()
      )?.person_id ?? null,
  },
  'party.consent.recorded': {
    subject: async (tx, { entityId }) =>
      (
        await partyDb(tx)
          .selectFrom('party.consent')
          .select('person_id')
          .where('id', '=', entityId)
          .executeTakeFirst()
      )?.person_id ?? null,
  },
};
