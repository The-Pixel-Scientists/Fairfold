// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field classification for the app schema. Ids, statuses and settings are
// internal; a tenant's slug, name and theme are public, since its public
// pages show them (ADR 0019). A membership's user_id links the tenant to a
// person's account, so it is personal, like party.person.user_id (ADR 0017).

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
};
