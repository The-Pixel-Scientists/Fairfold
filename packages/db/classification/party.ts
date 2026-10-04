// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the party schema (ADR 0017). A person's names,
// email, phone and account link, everything a consent row says, and an
// organisation's registered address, which for a small group is often
// someone's home, are personal. Row and tenant ids are internal, as in
// every schema. The rest is internal too, including organisation names,
// legal forms, websites and identifiers, which a tenant may choose to
// publish for awarded grants. Nothing is special category. Records are kept
// while the tenant is a customer; erasure anonymises a person in place
// (ADR 0017), and its rule arrives with the erasure ADR.

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};

const keyAndActors = {
  tenant_id: internal,
  id: internal,
  created_at: internal,
  created_by: internal,
  updated_at: internal,
  updated_by: internal,
} as const;

export const party: ClassificationRegistry = {
  'party.party': {
    ...keyAndActors,
    kind: internal,
    status: internal,
  },
  'party.organisation': {
    ...keyAndActors,
    kind: internal,
    name: internal,
    legal_form: internal,
    address_line1: personal,
    address_line2: personal,
    address_town: personal,
    address_postcode: personal,
    address_country_code: personal,
    website: internal,
  },
  'party.organisation_identifier': {
    ...keyAndActors,
    organisation_id: internal,
    scheme: internal,
    identifier: internal,
    verified_at: internal,
    verified_by: internal,
  },
  'party.person': {
    ...keyAndActors,
    kind: internal,
    given_name: personal,
    family_name: personal,
    email: personal,
    phone: personal,
    user_id: personal,
  },
  'party.relationship': {
    ...keyAndActors,
    type: internal,
    subject_id: internal,
    subject_kind: internal,
    object_id: internal,
    object_kind: internal,
    starts_on: internal,
    ends_on: internal,
  },
  'party.consent': {
    tenant_id: internal,
    id: internal,
    person_id: personal,
    purpose: personal,
    channel: personal,
    state: personal,
    privacy_notice_version: personal,
    source: personal,
    recorded_at: personal,
    recorded_by: personal,
  },
};
