// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's checked lists (ADR 0017). The database checks the same
// values, so adding one is a contract change and a migration.

import { z } from 'zod';

import { choice, partyMessages } from './messages.ts';

/** An organisation's legal form, with the words the apps show for it. */
export const legalForms = {
  registered_charity: 'Registered charity',
  charitable_incorporated_organisation: 'Charitable incorporated organisation (CIO)',
  company_limited_by_guarantee: 'Company limited by guarantee',
  community_interest_company: 'Community interest company (CIC)',
  community_benefit_society: 'Community benefit society',
  unincorporated_group: 'Unincorporated group or club',
  public_body: 'Public body',
  other: 'Other',
} as const;

export type LegalForm = keyof typeof legalForms;

export const legalFormSchema = z.enum(Object.keys(legalForms) as [LegalForm, ...LegalForm[]]);

/** What a party is. A party's kind never changes. */
export const partyKinds = ['organisation', 'person'] as const;

export type PartyKind = (typeof partyKinds)[number];

export const partyKindSchema = z.enum(partyKinds);

/** A typed link between two parties. `contact_for` joins a person to an organisation. */
export const relationshipTypes = ['contact_for'] as const;

export type RelationshipType = (typeof relationshipTypes)[number];

export const relationshipTypeSchema = z.enum(relationshipTypes);

/**
 * Each type's label and the kind of party at each end, which the database
 * checks too. Only a current `contact_for` gives a person access to an
 * organisation in the portal.
 */
export const relationshipTypeRules = {
  contact_for: { label: 'Contact for', from: 'person', to: 'organisation' },
} as const satisfies Record<
  RelationshipType,
  { readonly label: string; readonly from: PartyKind; readonly to: PartyKind }
>;

/** What a person agrees to be contacted about. */
export const consentPurposes = ['future_funding'] as const;

export type ConsentPurpose = (typeof consentPurposes)[number];

export const consentPurposeSchema = z.enum(consentPurposes);

export const consentPurposeLabels = {
  future_funding: 'Future funding opportunities',
} as const satisfies Record<ConsentPurpose, string>;

/** Electronic marketing consent is given per channel. */
export const consentChannels = ['email', 'sms', 'phone', 'post'] as const;

export type ConsentChannel = (typeof consentChannels)[number];

export const consentChannelSchema = z.enum(consentChannels);

export const consentChannelLabels = {
  email: 'Email',
  sms: 'Text message',
  phone: 'Phone',
  post: 'Post',
} as const satisfies Record<ConsentChannel, string>;

/** The channels an applicant can choose in the portal in MVP1. */
export const portalConsentChannels = ['email'] as const satisfies readonly ConsentChannel[];

export const consentStates = ['given', 'withdrawn'] as const;

export const consentStateSchema = z.enum(consentStates);

/**
 * Why a person must not be contacted on a channel (ADR 0033). `bounced` is
 * the one hard suppression: it stops transactional mail too. Staff record
 * only `fps_request` and `staff_entry`.
 */
export const suppressionReasons = {
  unsubscribed: 'Unsubscribed from a message',
  bounced: 'Email address does not exist',
  complained: 'Reported a message as spam',
  fps_request: 'Fundraising Preference Service request',
  staff_entry: 'Asked us not to contact them',
} as const;

export type SuppressionReason = keyof typeof suppressionReasons;

export const suppressionReasonSchema = choice(
  Object.keys(suppressionReasons) as [SuppressionReason, ...SuppressionReason[]],
  partyMessages.suppressionReason,
);

export const hardSuppressionReasons = ['bounced'] as const satisfies readonly SuppressionReason[];

export const staffSuppressionReasons = [
  'fps_request',
  'staff_entry',
] as const satisfies readonly SuppressionReason[];

/** Why a message was not sent, kept on the module's outbox row (ADR 0033). */
export const skipCodes = {
  no_consent: 'No consent to contact',
  consent_withdrawn: 'Consent withdrawn',
  suppressed: 'Asked not to be contacted',
  person_erased: 'Personal data erased',
  no_contact_point: 'No address for this channel',
} as const;

export type SkipCode = keyof typeof skipCodes;

export const skipCodeSchema = choice(
  Object.keys(skipCodes) as [SkipCode, ...SkipCode[]],
  partyMessages.skipCode,
);

/**
 * The party fields whose changes value history keeps (ADR 0025), with the
 * kind of party each belongs to. Named after their columns; an identifier
 * is kept in its org-id form, such as `GB-CHC-1234567`.
 */
export const valueHistoryFields = {
  'organisation.name': 'organisation',
  'organisation.legal_form': 'organisation',
  'organisation.address_line1': 'organisation',
  'organisation.address_line2': 'organisation',
  'organisation.address_town': 'organisation',
  'organisation.address_postcode': 'organisation',
  'organisation.address_country_code': 'organisation',
  'organisation.website': 'organisation',
  'organisation.identifier': 'organisation',
  'person.given_name': 'person',
  'person.family_name': 'person',
  'person.email': 'person',
  'person.phone': 'person',
} as const satisfies Record<string, PartyKind>;

export type ValueHistoryField = keyof typeof valueHistoryFields;

export const valueHistoryFieldSchema = z.enum(
  Object.keys(valueHistoryFields) as [ValueHistoryField, ...ValueHistoryField[]],
);
