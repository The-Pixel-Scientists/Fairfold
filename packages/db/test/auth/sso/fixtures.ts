// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rows for the SSO tables of migration 0027. Each helper runs on a client
// connected as migrator with the row's tenant set (committedIn()).

import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { withClient } from '../../connect.ts';
import {
  addMember,
  committedIn,
  insertRow,
  testSlug,
  type Row,
  type TestTenant,
} from '../../tenants.ts';

export const CERTIFICATE =
  '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----';

/** A SAML provider with no secret, by a new administrator. */
export async function samlProvider(client: pg.ClientBase, tenant: TestTenant): Promise<Row> {
  const member = await addMember(client, tenant);
  return {
    tenant_id: tenant.id,
    kind: 'saml',
    name: 'Staff sign-in',
    entity_id: `https://idp.example.test/${testSlug()}`,
    sso_url: 'https://idp.example.test/sso',
    certificates: [CERTIFICATE],
    mfa_contexts: [],
    created_by: member,
    updated_by: member,
  };
}

/** An OIDC provider whose sealed secret, here random bytes, used key version `version`. */
export async function oidcProvider(
  client: pg.ClientBase,
  tenant: TestTenant,
  version = 1,
): Promise<Row> {
  const member = await addMember(client, tenant);
  return {
    tenant_id: tenant.id,
    kind: 'oidc',
    name: 'Staff sign-in',
    issuer: 'https://login.example.test',
    client_id: 'client',
    client_secret: randomBytes(60),
    authorization_endpoint: 'https://login.example.test/authorize',
    token_endpoint: 'https://login.example.test/token',
    jwks_uri: 'https://login.example.test/keys',
    mfa_amr: ['mfa'],
    mfa_acr: [],
    key_version: version,
    created_by: member,
    updated_by: member,
  };
}

/** Add a SAML provider and return its id and the member who added it. */
export async function addProvider(
  client: pg.ClientBase,
  tenant: TestTenant,
): Promise<{ id: string; member: string; issuer: string }> {
  const row = await samlProvider(client, tenant);
  return {
    id: await insertRow(client, 'auth.sso_provider', row),
    member: String(row.created_by),
    issuer: String(row.entity_id),
  };
}

/** A pending domain claim of `domain` for a new provider. */
export async function domainClaim(
  client: pg.ClientBase,
  tenant: TestTenant,
  domain = `${testSlug()}.example.test`,
): Promise<Row> {
  const { id, member } = await addProvider(client, tenant);
  return {
    tenant_id: tenant.id,
    provider_id: id,
    domain,
    dns_token: randomBytes(32).toString('base64url'),
    created_by: member,
    updated_by: member,
  };
}

/**
 * Remove a tenant's providers, and with them its SSO identities, which
 * nothing else may delete. Migration 0027's down refuses while any exists.
 */
export function removeProviders(tenant: TestTenant): Promise<unknown> {
  return withClient('migrator', (client) =>
    committedIn(client, tenant.id, (inTenant) => inTenant.query('DELETE FROM auth.sso_provider')),
  );
}
