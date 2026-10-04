// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's checked lists (ADR 0017). The database checks the same
// values, so adding one is a contract change and a migration.

import { z } from 'zod';

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

/** A typed link between two parties. `contact_for` joins a person to an organisation. */
export const relationshipTypes = ['contact_for'] as const;

export type RelationshipType = (typeof relationshipTypes)[number];

/** What a person agrees to be contacted about. */
export const consentPurposes = ['future_funding'] as const;

export const consentPurposeSchema = z.enum(consentPurposes);

/** Electronic marketing consent is given per channel. */
export const consentChannels = ['email', 'sms', 'phone', 'post'] as const;

export type ConsentChannel = (typeof consentChannels)[number];

export const consentChannelSchema = z.enum(consentChannels);

/** The channels an applicant can choose in the portal in MVP1. */
export const portalConsentChannels = ['email'] as const satisfies readonly ConsentChannel[];

export const consentStates = ['given', 'withdrawn'] as const;

export const consentStateSchema = z.enum(consentStates);
