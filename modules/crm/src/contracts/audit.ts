// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's audit action codes (architecture rule 4, ADR 0025,
// ADR 0027). Values are ids, codes, counts and field ids only: never a
// name, email address, search term, interaction summary, filter value or
// import cell. The party an event is about travels as the subject party id
// in the audit context, never as a value. The merge itself is also recorded
// by party as `party.party.merged` or `party.party.unmerged`. Which read
// writes which action is crmReadAudits, below.

import { defineAuditActions } from '@pixel-scientists/domain/platform';

export const crmAuditActions = defineAuditActions('crm', [
  'crm.party.found',
  'crm.party.viewed',
  'crm.timeline.viewed',
  'crm.interaction.recorded',
  'crm.duplicate.viewed',
  'crm.duplicate.dismissed',
  'crm.merge.previewed',
  'crm.merge.confirmed',
  'crm.merge.reversed',
  'crm.list.created',
  'crm.list.updated',
  'crm.list.archived',
  'crm.list_member.added',
  'crm.list_member.removed',
  'crm.segment.saved',
  'crm.segment.archived',
  'crm.import.started',
  'crm.import.previewed',
  'crm.import.confirmed',
  'crm.external_reference.added',
  'crm.external_reference.removed',
]);

export type CrmAuditAction = (typeof crmAuditActions)[number];

/**
 * The sensitive reads, by route: the action each writes in the same
 * transaction as the read, with the subject party id in the audit context.
 * Records and timelines write on every read, whatever the party's kind: an
 * organisation's record holds its contacts' names and email addresses, and
 * any timeline may hold staff's notes about people. crm writes its own
 * action even where party's read contract also writes one. Search and
 * duplicates write only for a page that holds a person, with the result
 * ids. routes.test.ts checks that every route answering a field marked
 * personal is listed here or records a change of its own.
 */
export const crmReadAudits = {
  searchParties: 'crm.party.found',
  getOrganisationRecord: 'crm.party.viewed',
  getPersonRecord: 'crm.party.viewed',
  getTimeline: 'crm.timeline.viewed',
  listDuplicates: 'crm.duplicate.viewed',
  listPartyDuplicates: 'crm.duplicate.viewed',
  previewMerge: 'crm.merge.previewed',
  listImportRows: 'crm.import.previewed',
} as const satisfies Record<string, CrmAuditAction>;
