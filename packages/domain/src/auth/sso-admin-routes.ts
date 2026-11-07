// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Setting up a tenant's SSO in the console (ADR 0010, SSO): its OIDC and
// SAML providers, and the email domains each may sign in. Changes need
// step-up and are audited; reads do not. A domain counts only once its DNS
// record is verified, and a domain another tenant has verified is refused
// after the proof, with messages.ssoDomainConflict, which names no tenant.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { idSchema } from '../id.ts';
import {
  addedDomainSchema,
  addProviderSchema,
  changeProviderSchema,
  domainNameSchema,
  ssoDomainSchema,
  ssoProviderListSchema,
  ssoProviderSchema,
} from './sso-schemas.ts';

const manage = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.sso.manage',
  scope: 'tenant',
} as const;

const change = { ...manage, stepUp: true } as const;

const providerParams = z.strictObject({ providerId: idSchema });
const domainParams = z.strictObject({ providerId: idSchema, domainId: idSchema });

export const listSsoProviders = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/sso/providers',
  summary: 'List the single sign-on providers',
  responses: { 200: ssoProviderListSchema },
});

export const getSsoProvider = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/sso/providers/:providerId',
  summary: 'Read a single sign-on provider and its domains',
  params: providerParams,
  responses: { 200: ssoProviderSchema },
});

export const addSsoProvider = defineRoute({
  ...change,
  method: 'POST',
  idempotent: true,
  path: '/console/sso/providers',
  summary: 'Add an OIDC or SAML single sign-on provider',
  body: addProviderSchema,
  responses: { 201: ssoProviderSchema },
});

/** A secret left out keeps the one stored. */
export const changeSsoProvider = defineRoute({
  ...change,
  method: 'PUT',
  path: '/console/sso/providers/:providerId',
  summary: 'Change a single sign-on provider',
  params: providerParams,
  body: changeProviderSchema,
  responses: { 200: ssoProviderSchema },
});

export const removeSsoProvider = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/console/sso/providers/:providerId',
  summary: 'Remove a single sign-on provider and its domains',
  params: providerParams,
  responses: { 204: null },
});

export const addSsoDomain = defineRoute({
  ...change,
  method: 'POST',
  idempotent: true,
  path: '/console/sso/providers/:providerId/domains',
  summary: 'Add an email domain, and get the DNS record that proves it is yours',
  params: providerParams,
  body: z.strictObject({ domain: domainNameSchema }),
  responses: { 201: addedDomainSchema },
});

export const verifySsoDomain = defineRoute({
  ...change,
  method: 'POST',
  path: '/console/sso/providers/:providerId/domains/:domainId/verify',
  summary: 'Check the DNS record and verify an email domain',
  params: domainParams,
  responses: { 200: ssoDomainSchema },
});

export const removeSsoDomain = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/console/sso/providers/:providerId/domains/:domainId',
  summary: 'Remove an email domain',
  params: domainParams,
  responses: { 204: null },
});

/** Every SSO administration route, walked by the same rules as authRoutes. */
export const ssoAdminRoutes = {
  listSsoProviders,
  getSsoProvider,
  addSsoProvider,
  changeSsoProvider,
  removeSsoProvider,
  addSsoDomain,
  verifySsoDomain,
  removeSsoDomain,
} as const;
