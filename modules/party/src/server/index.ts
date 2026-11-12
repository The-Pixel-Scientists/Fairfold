// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's server entry point (ADR 0016, ADR 0017). Other modules
// call the functions below in their own request transaction, so the whole
// request commits or rolls back together. A caller that gets `created: true`
// from ensurePersonForUser() writes the `party.person.created` audit event.
// `partyHandlers` and `partyResolvers` are for apps/api/src/modules.ts alone, which registers the
// routes and the scope rules. `partySubjectRules` is for the platform's audit
// writer alone. `partyWarehouse` feeds the warehouse snapshot.
// `partySubjectData` and `partyMergeSet` serve subject access. `partyErasure` and
// `partyErasureTarget` serve erasure. `partyRecordHandlers` serves the staff
// routes that change records. `createPartyMerges` is crm's merge, duplicate and
// resolve contract, over the re-points apps/api registers with `partyRepoint`.

export {
  contactDetails,
  ensurePersonForUser,
  isCurrentContact,
  peopleByUserIds,
  personIdForUser,
} from './people.ts';
export { organisationName, organisationSummaries } from './organisations.ts';
export {
  partyHandlers,
  partyResolvers,
  type PartyContext,
  type PartyDependencies,
} from './handlers.ts';
export { partyRecordHandlers, type PartyRecordDependencies } from './record-handlers.ts';
export { createPartyMerges } from './merge.ts';
export type { PartyRequest } from './request.ts';
export { partyRepoint } from './repoint.ts';
export { partySubjectRules, type SubjectRule } from './audit.ts';
export { partyWarehouse } from './warehouse.ts';
export {
  partyErasure,
  partyErasureTarget,
  runningErasureRequest,
  type ErasureTarget,
} from './erasure.ts';
export { partyMergeSet, partySubjectData } from './subject-data.ts';
export {
  readOrganisationSnapshot,
  takeOrganisationSnapshot,
  type SnapshotContext,
} from './snapshot.ts';
