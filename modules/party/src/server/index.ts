// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's server entry point (ADR 0016, ADR 0017). Other modules
// call the functions below in their own request transaction, so the whole
// request commits or rolls back together. A caller that gets `created: true`
// from ensurePersonForUser() writes the `party.person.created` audit event.
// `partyHandlers` and `partyResolvers` are for apps/api/src/modules.ts alone, which registers the
// routes and the scope rules.

export {
  contactDetails,
  ensurePersonForUser,
  isCurrentContact,
  peopleByUserIds,
  personIdForUser,
} from './people.ts';
export { organisationSummaries } from './organisations.ts';
export {
  partyHandlers,
  partyResolvers,
  type PartyContext,
  type PartyDependencies,
} from './handlers.ts';
