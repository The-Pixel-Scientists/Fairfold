// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the app schema. Ids, statuses and settings are
// internal; a tenant's slug, name and theme are public, since its public
// pages show them (ADR 0019). A membership's user_id links the tenant to a
// person's account, so it is personal, like party.person.user_id (ADR 0017).
// Audit events hold ids, codes and public or internal values only (ADR 0003,
// D12), and are kept under the tenant's audit rule, at least 12 months.

import type { ClassificationRegistry, FieldClassification } from '../classification.ts';

const internal: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_lifetime' },
};
const publicField: FieldClassification = {
  sensitivity: 'public',
  retention: { kind: 'tenant_lifetime' },
};
const personal: FieldClassification = {
  sensitivity: 'personal',
  retention: { kind: 'tenant_lifetime' },
};
const invitation: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'fixed', days: 90, from: 'expires_at' },
};
const audit: FieldClassification = {
  sensitivity: 'internal',
  retention: { kind: 'tenant_policy', policy: 'audit', minimumDays: 365 },
};

export const app: ClassificationRegistry = {
  'app.tenant': {
    id: internal,
    slug: publicField,
    name: publicField,
    status: internal,
    timezone: internal,
    fiscal_year_start_month: internal,
    created_at: internal,
    updated_at: internal,
  },
  'app.membership': {
    tenant_id: internal,
    id: internal,
    user_id: personal,
    roles: internal,
    status: internal,
    created_at: internal,
    created_by: internal,
    updated_at: internal,
    updated_by: internal,
  },
  'app.tenant_module': {
    tenant_id: internal,
    id: internal,
    module: internal,
    enabled: internal,
    updated_at: internal,
    updated_by: internal,
  },
  'app.tenant_theme': {
    tenant_id: internal,
    id: internal,
    brand_colour: publicField,
    preset: publicField,
    logo: publicField,
    logo_type: publicField,
    tokens: publicField,
    updated_at: internal,
    updated_by: internal,
  },
  'app.config_version': {
    tenant_id: internal,
    id: internal,
    entity_type: internal,
    entity_id: internal,
    version: internal,
    author_id: internal,
    diff: internal,
    created_at: internal,
  },
  'app.retention_policy': {
    tenant_id: internal,
    id: internal,
    policy: internal,
    days: internal,
    created_at: internal,
    created_by: internal,
    updated_at: internal,
    updated_by: internal,
  },
  // An uploaded file (ADR 0047). Its name often names a person. A linked
  // file follows its record's retention rule, as grants.application's; a
  // refused (infected or error) row, linked to nothing, follows the
  // 12-month audit floor, for the retention sweep (S11-102).
  'app.file': {
    tenant_id: internal,
    id: internal,
    name: personal,
    content_type: internal,
    size_bytes: internal,
    sha256: internal,
    // The object this key names holds personal content, under the same rule.
    storage_key: internal,
    scan_state: internal,
    scanned_at: internal,
    created_by: internal,
    created_at: internal,
  },
  // An invitation to the team (ADR 0010). The address names a person who may
  // never join, so every row goes 90 days after it expires, whatever its
  // status; a membership it made stays.
  'app.invitation': {
    tenant_id: invitation,
    id: invitation,
    email: { ...invitation, sensitivity: 'personal' },
    roles: invitation,
    token_hash: invitation,
    expires_at: invitation,
    status: invitation,
    accepted_membership_id: invitation,
    created_at: invitation,
    created_by: invitation,
    updated_at: invitation,
    updated_by: invitation,
  },
  'app.audit_event': {
    tenant_id: audit,
    id: audit,
    occurred_at: audit,
    retain_until: audit,
    request_id: audit,
    actor_kind: audit,
    actor_id: audit,
    action: audit,
    entity_type: audit,
    entity_id: audit,
    changes: audit,
  },
};
