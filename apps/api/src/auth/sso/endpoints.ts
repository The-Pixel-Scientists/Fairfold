// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checks on an SSO provider's addresses and keys when it is saved (ADR 0010,
// "SSO" and "Outbound requests"). Every endpoint address must be HTTPS,
// carry no user name or password, and name no IP literal that the outbound
// dispatcher would refuse. An OIDC discovery document is fetched once,
// through the global dispatcher, which checks every address it connects
// to; it is size-limited and schema-checked before any address in it is
// read, and none of those addresses is fetched on save. A problem names the
// field to fix, and never a value the request or the provider sent.

import { createPrivateKey, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

import type { FieldProblem } from '@pixel-scientists/domain/platform';
import { messages } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { bareHost } from '../../outbound/connect.ts';
import { isGloballyReachable } from '../../outbound/ranges.ts';
import { ApiError } from '../../problems.ts';

/** A discovery document is a few kilobytes; the dispatcher caps any body at 1 MB. */
const DOCUMENT_MAX_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

/** Whether `text` is an address the API may call: see the file comment. */
export function isAllowedEndpoint(text: string): boolean {
  const url = URL.parse(text);
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = bareHost(url.hostname);
  return isIP(host) === 0 ? host.length > 0 : isGloballyReachable(host);
}

export const refused = (errors: readonly FieldProblem[], reason: string): ApiError =>
  new ApiError(400, messages.fixFields, { errors, reason });

const ENDPOINT_KEYS = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
  'userinfo_endpoint',
] as const;

const address = z.string().max(2048);
const discoverySchema = z.object({
  issuer: address,
  authorization_endpoint: address,
  token_endpoint: address,
  jwks_uri: address,
  userinfo_endpoint: address.optional(),
});

export interface OidcEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly userinfoEndpoint: string | null;
}

const issuerProblem = (message: string): ApiError =>
  refused([{ field: 'body.issuer', message }], 'sso_discovery');

/**
 * Check a discovery document, fetched or pasted, for `issuer`, and return
 * its endpoints. Throws a problem naming the issuer field.
 */
export function checkDiscovery(issuer: string, document: unknown): OidcEndpoints {
  const parsed = discoverySchema.safeParse(document);
  if (!parsed.success) {
    throw issuerProblem(
      "The provider's discovery document is not in the form OpenID Connect sets out. Check the issuer address with the provider.",
    );
  }
  const found = parsed.data;
  if (found.issuer !== issuer) {
    throw issuerProblem(
      "The provider's discovery document names a different issuer. Enter the issuer exactly as the provider gives it.",
    );
  }
  const bad = ENDPOINT_KEYS.filter((key) => {
    const value = found[key];
    return value !== undefined && !isAllowedEndpoint(value);
  });
  if (bad.length > 0) {
    throw refused(
      bad.map((key) => ({
        field: 'body.issuer',
        message: `The provider's discovery document gives ${key} as an address that cannot be used. Ask the provider for an HTTPS address with a domain name and no user name or password.`,
      })),
      'sso_endpoint',
    );
  }
  return {
    authorizationEndpoint: found.authorization_endpoint,
    tokenEndpoint: found.token_endpoint,
    jwksUri: found.jwks_uri,
    userinfoEndpoint: found.userinfo_endpoint ?? null,
  };
}

/** Fetch `issuer`'s discovery document once and check it. `fetcher` is the global fetch outside tests. */
export async function discover(
  issuer: string,
  fetcher: typeof fetch = fetch,
): Promise<OidcEndpoints> {
  if (!isAllowedEndpoint(issuer)) {
    throw issuerProblem(messages.httpsAddress);
  }
  const unreadable = () =>
    issuerProblem(
      "We could not read the provider's discovery document. Check the issuer address, then try again.",
    );
  let text: string;
  try {
    const response = await fetcher(
      `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
      {
        headers: { accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw unreadable();
    text = await response.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unreadable();
  }
  if (Buffer.byteLength(text, 'utf8') > DOCUMENT_MAX_BYTES) throw unreadable();
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw unreadable();
  }
  return checkDiscovery(issuer, document);
}

export interface CertificateFacts {
  readonly sha256: string;
  readonly expiresAt: string;
}

/** Each certificate's fingerprint and expiry, or a problem naming the one that will not parse. */
export function certificateFacts(
  certificates: readonly string[],
  field = 'body.certificates',
): CertificateFacts[] {
  return certificates.map((pem, index) => {
    try {
      const certificate = new X509Certificate(pem);
      return {
        sha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
        expiresAt: certificate.validToDate.toISOString(),
      };
    } catch {
      throw refused(
        [{ field: `${field}.${String(index)}`, message: messages.certificate }],
        'sso_certificate',
      );
    }
  });
}

/** Throws unless `privateKey` is a private key that `certificate` holds the public half of. */
export function checkSigningPair(privateKey: string, certificate: string): void {
  let matches: boolean;
  try {
    matches = new X509Certificate(certificate).checkPrivateKey(createPrivateKey(privateKey));
  } catch {
    matches = false;
  }
  if (!matches) {
    throw refused(
      [
        {
          field: 'body.spSigning.privateKey',
          message:
            'This private key does not match the signing certificate. Paste the key and certificate that were made together.',
        },
      ],
      'sso_signing_pair',
    );
  }
}
