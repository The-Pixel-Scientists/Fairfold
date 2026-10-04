// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's published contracts (ADR 0016, ADR 0017): checked
// lists, schemas, routes and audit action codes, safe for the browser.

import '@pixel-scientists/domain/jitless';

export {
  addressSchema,
  consentSchema,
  consoleOrganisationSchema,
  consolePersonSchema,
  organisationPageSchema,
  organisationSummarySchema,
  portalOrganisationListSchema,
  portalOrganisationSchema,
  profileSchema,
  type Consent,
  type ConsoleOrganisation,
  type ConsolePerson,
  type ContactDetails,
  type OrganisationPage,
  type OrganisationSummary,
  type PersonName,
  type PortalOrganisation,
  type PortalOrganisationList,
  type Profile,
} from './answers.ts';
export { partyAuditActions, type PartyAuditAction } from './audit.ts';
export {
  identifierInputSchema,
  identifierSchemeIds,
  identifierSchemeSchema,
  identifierSchemes,
  normaliseIdentifier,
  type IdentifierInput,
  type IdentifierScheme,
} from './identifiers.ts';
export {
  addressInputSchema,
  consentChangeSchema,
  organisationInputSchema,
  organisationQuerySchema,
  partyCursorSchema,
  profileInputSchema,
  type ConsentChange,
  type OrganisationInput,
  type OrganisationQuery,
  type ProfileInput,
} from './inputs.ts';
export {
  consentChannels,
  consentChannelSchema,
  consentPurposes,
  consentPurposeSchema,
  consentStates,
  consentStateSchema,
  legalForms,
  legalFormSchema,
  portalConsentChannels,
  relationshipTypes,
  type ConsentChannel,
  type LegalForm,
  type RelationshipType,
} from './lists.ts';
export { partyMessages, type PartyMessage } from './messages.ts';
export {
  createOrganisation,
  getMyOrganisation,
  getOrganisation,
  getPerson,
  getProfile,
  listMyOrganisations,
  listOrganisations,
  partyRoutes,
  recordConsent,
  updateMyOrganisation,
  updateProfile,
} from './routes.ts';
