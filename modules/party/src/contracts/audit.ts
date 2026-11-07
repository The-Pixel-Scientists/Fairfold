// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's audit action codes (architecture rule 4, ADR 0017).
// Events hold ids, codes and field ids, never personal values, and the
// party they are about travels as the subject party id in the audit
// context (ADR 0027), never as a value. The `viewed` codes are sensitive
// reads by staff: a person's details, an organisation's registered address
// and contacts, and value history, which holds old values.
// Staff edits use the `updated` codes; preference changes and unsubscribes
// use `party.consent.recorded`.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const partyAuditActions = defineAuditActions('party', [
  'party.person.created',
  'party.person.updated',
  'party.person.viewed',
  'party.organisation.created',
  'party.organisation.updated',
  'party.organisation.viewed',
  'party.relationship.created',
  'party.consent.recorded',
  'party.identifier.added',
  'party.identifier.removed',
  'party.identifier.verified',
  'party.relationship.ended',
  'party.party.merged',
  'party.party.erased',
  'party.suppression.added',
  'party.organisation_snapshot.created',
  'party.value_history.viewed',
]);

export type PartyAuditAction = (typeof partyAuditActions)[number];
