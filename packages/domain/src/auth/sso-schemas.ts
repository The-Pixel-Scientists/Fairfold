// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's SSO providers and their email domains, as the console sets them
// up (ADR 0010, SSO). Secrets are write-only: a client secret or SAML signing
// key goes in, and no answer ever holds one. A change that leaves a secret
// out keeps the stored one.

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { messages } from '../platform/messages.ts';

type ParsedUrl = { readonly href: string; readonly username: string; readonly password: string };

/** The WHATWG URL parser, reached through globalThis so the package needs no DOM or Node.js types. */
function parseUrl(text: string): ParsedUrl | null {
  return (globalThis as unknown as { URL: { parse(text: string): ParsedUrl | null } }).URL.parse(
    text,
  );
}

/**
 * Spelt `https://`, and as the parser reads it: no user name or password.
 * The parser also reads `https:host` and `https:\host`, so the text alone
 * proves nothing.
 */
function isPlainHttps(text: string): boolean {
  const url = parseUrl(text);
  return /^https:\/\//i.test(text) && url?.username === '' && url.password === '';
}

/**
 * HTTPS, a domain name rather than an IP literal, and no user name or
 * password, kept in the parser's own form so what is checked is what is
 * stored. The server checks each address again when it connects
 * (ADR 0010, Outbound requests).
 */
const httpsUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain, error: messages.httpsAddress })
  .max(2048, { error: messages.httpsAddress })
  .refine(isPlainHttps, { error: messages.httpsAddress })
  .transform((text) => parseUrl(text)?.href ?? text)
  .pipe(z.string().max(2048, { error: messages.httpsAddress }));

/** One PEM block in lines of up to 76 characters, so a pasted bundle cannot hide a second. */
const pem = (pattern: RegExp, error: string) =>
  z.string().trim().max(8192, { error }).regex(pattern, { error });

const certificate = pem(
  /^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]{1,76}\r?\n)+-----END CERTIFICATE-----$/,
  messages.certificate,
);

/** Plain text a provider asserts or we show: one line, bounded. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u, { error: messages.tenantNameHidden });

/**
 * An email domain: lower case, in its IDNA ASCII form, no trailing dot, and
 * a last label starting with a letter, so never an IP literal.
 */
export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .max(253, { error: messages.domainName })
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
        error: messages.domainName,
      }),
  );

/** Which asserted values count as MFA at the provider; none means staff complete MFA here. */
const mfaValues = z.array(line(256)).max(10);

const oidcFields = {
  kind: z.literal('oidc'),
  name: line(100),
  /** Its discovery document is fetched from here. */
  issuer: httpsUrl,
  clientId: line(256),
  /** OIDC `amr` and `acr` values. */
  mfa: z.strictObject({ amr: mfaValues, acr: mfaValues }),
};

const samlFields = {
  kind: z.literal('saml'),
  name: line(100),
  entityId: line(1024),
  ssoUrl: httpsUrl,
  /** The provider's signing certificates, the only keys an assertion is checked with. */
  certificates: z.array(certificate).min(1).max(3),
  /** `AuthnContextClassRef` values. */
  mfaContexts: mfaValues,
};

const clientSecret = z.string().min(1).max(1024);

/** Signs our authentication requests, for a provider that asks for it. */
const spSigning = z.strictObject({
  privateKey: pem(
    /^-----BEGIN PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{1,76}\r?\n)+-----END PRIVATE KEY-----$/,
    messages.privateKey,
  ),
  certificate,
});

export const addProviderSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...oidcFields, clientSecret }),
  z.strictObject({ ...samlFields, spSigning: spSigning.optional() }),
]);

export const changeProviderSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...oidcFields, clientSecret: clientSecret.optional() }),
  z.strictObject({ ...samlFields, spSigning: spSigning.optional() }),
]);

export const ssoDomainSchema = z.object({
  id: idSchema,
  domain: z.string(),
  status: z.enum(['pending', 'verified']),
  verifiedAt: z.iso.datetime().nullable(),
});

/** What to publish to prove the domain: a TXT record at `name` holding `value`. */
export const addedDomainSchema = ssoDomainSchema.extend({
  dnsRecord: z.object({ type: z.literal('TXT'), name: z.string(), value: z.string() }),
});

const providerBase = {
  id: idSchema,
  name: z.string(),
  domains: z.array(ssoDomainSchema),
  updatedAt: z.iso.datetime(),
};

/** A provider as the console shows it. Never a secret or private key. */
export const ssoProviderSchema = z.discriminatedUnion('kind', [
  z.object({
    ...providerBase,
    kind: z.literal('oidc'),
    issuer: z.string(),
    clientId: z.string(),
    mfa: z.object({ amr: z.array(z.string()), acr: z.array(z.string()) }),
    /** To register with the provider. */
    redirectUri: z.string(),
  }),
  z.object({
    ...providerBase,
    kind: z.literal('saml'),
    entityId: z.string(),
    ssoUrl: z.string(),
    certificates: z.array(z.object({ sha256: z.string(), expiresAt: z.iso.datetime() })),
    mfaContexts: z.array(z.string()),
    /** Our side, to register with the provider. */
    sp: z.object({ entityId: z.string(), acsUrl: z.string(), signs: z.boolean() }),
  }),
]);

export const ssoProviderListSchema = z.object({
  providers: z.array(
    z.object({
      id: idSchema,
      kind: z.enum(['oidc', 'saml']),
      name: z.string(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});
