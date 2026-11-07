// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signing in through a tenant's own identity provider (ADR 0010, SSO). The
// start answers where to send the browser; the provider sends it back to the
// OIDC callback or the SAML ACS, which redirect to a page of the app. A SAML
// response first goes to the ACS, which checks it and redirects with a
// single-use completion handle, valid for 2 minutes, to the completion
// route, which checks the browser's cookie before creating the session.
// Every end needs the cookie set at the start, and its state or request id,
// which bind the tenant and provider, so no route takes a tenant, a user or
// a target to redirect to. An SSO step-up starts from a complete session and
// returns through the same ends, its state naming that session.
//
// The handlers forward to the SSO plugin's sign-in/sso, callback and SAML
// ACS endpoints behind our own checks (S11-62 and S11-90 confirm the names
// against the pinned plugin); its registration and domain endpoints stay off
// the allowlist.

import { z } from 'zod';

import { defineRoute } from '../api/route.ts';
import { idSchema } from '../id.ts';
import { slugSchema } from '../platform/tenant.ts';
import { emailSchema } from './schemas.ts';

const common = { audience: 'auth', module: 'platform', permission: null, scope: null } as const;

/** Our own single-use values: OIDC state, SAML RelayState and the completion handle. */
const opaque = z.string().regex(/^[A-Za-z0-9_-]{20,80}$/);
const text = (max: number) => z.string().max(max);

/**
 * Where to send the browser: the provider's sign-in page, or null when no
 * verified domain of the tenant matches. A SAML request in the HTTP-Redirect
 * binding makes the address long.
 */
const startSchema = z.object({
  url: z
    .url({ protocol: /^https$/ })
    .max(8192)
    .nullable(),
});

const providerParams = z.strictObject({ slug: slugSchema, providerId: idSchema });

export const startSso = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/sso/start',
  summary: "Start signing in through your organisation's single sign-on",
  session: 'none',
  params: z.strictObject({ slug: slugSchema }),
  body: z.strictObject({ email: emailSchema }),
  responses: { 200: startSchema },
});

/** With `prompt=login` and `max_age=0`, or `ForceAuthn`: the provider must ask again. */
export const startSsoStepUp = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/sso/step-up',
  summary: "Confirm it is you through your organisation's single sign-on",
  session: 'complete',
  responses: { 200: startSchema },
});

/** Keys from the provider beside the code (RFC 6749, RFC 9207), read only to report a refusal. */
export const completeOidc = defineRoute({
  ...common,
  method: 'GET',
  path: '/auth/tenants/:slug/sso/oidc/:providerId/callback',
  summary: 'Finish an OIDC sign-in and go on to the app',
  session: 'none',
  ssoCompletion: 'oidc_callback',
  params: providerParams,
  query: z.strictObject({
    state: opaque,
    code: text(2048).optional(),
    iss: text(2048).optional(),
    session_state: text(512).optional(),
    error: text(64).optional(),
    error_description: text(1024).optional(),
  }),
  responses: { 303: null },
});

export const samlAcs = defineRoute({
  ...common,
  method: 'POST',
  path: '/auth/tenants/:slug/sso/saml/:providerId/acs',
  summary: 'Check a SAML response and go on to finish the sign-in',
  session: 'none',
  ssoCompletion: 'saml_acs',
  params: providerParams,
  body: z.strictObject({
    SAMLResponse: z
      .string()
      .max(262_144)
      .regex(/^[A-Za-z0-9+/=\r\n]+$/),
    RelayState: opaque,
  }),
  responses: { 303: null },
});

export const completeSaml = defineRoute({
  ...common,
  method: 'GET',
  path: '/auth/tenants/:slug/sso/saml/complete',
  summary: 'Finish a SAML sign-in in the browser that started it',
  session: 'none',
  ssoCompletion: 'saml_completion',
  params: z.strictObject({ slug: slugSchema }),
  query: z.strictObject({ handle: opaque }),
  responses: { 303: null },
});
