// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's audit action codes (architecture rule 4, ADR 0017).
// Events hold ids, codes and field ids, never personal values. The
// `viewed` codes are sensitive reads by staff: a person's details, and an
// organisation's registered address and contacts.

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
]);

export type PartyAuditAction = (typeof partyAuditActions)[number];
