// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A SAML AuthnRequest sent by the HTTP-Redirect binding only (ADR 0010, SAML
// rules; SAML 2.0 Bindings 3.4.4.1), so no auto-submitting page is needed
// under our CSP. The request is deflated and the query string, not the XML,
// is signed with RSA-SHA256 by the provider's SP key. Its id holds 256 bits
// from the CSPRNG. Every value comes from the stored provider, our own
// settings or the flow, never from the request.

import { randomBytes, sign, type KeyObject } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

export const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

/** An XML NCName, as the ID attribute requires. */
export const newRequestId = (): string => `_${randomBytes(32).toString('hex')}`;

export interface AuthnRequestInput {
  readonly requestId: string;
  /** The provider's stored SSO URL. */
  readonly ssoUrl: string;
  readonly spEntityId: string;
  readonly acsUrl: string;
  /** The provider's SP private key, opened from its sealed column. */
  readonly signingKey: KeyObject;
  /** Our own opaque value, never a place to go. */
  readonly relayState: string;
  /** Make the provider ask again (step-up). */
  readonly forceAuthn: boolean;
  readonly now: Date;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export function authnRequestXml(input: AuthnRequestInput): string {
  const attributes = [
    `ID="${escape(input.requestId)}"`,
    'Version="2.0"',
    `IssueInstant="${input.now.toISOString().replace(/\.\d{3}Z$/, 'Z')}"`,
    `Destination="${escape(input.ssoUrl)}"`,
    `AssertionConsumerServiceURL="${escape(input.acsUrl)}"`,
    'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    ...(input.forceAuthn ? ['ForceAuthn="true"'] : []),
  ];
  return (
    '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ' +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ${attributes.join(' ')}>` +
    `<saml:Issuer>${escape(input.spEntityId)}</saml:Issuer>` +
    '</samlp:AuthnRequest>'
  );
}

const PARAMETERS = ['SAMLRequest', 'RelayState', 'SigAlg', 'Signature'];

/** Where to send the browser. Our parameters replace any of the same name the stored URL carries. */
export function authnRequestUrl(input: AuthnRequestInput): string {
  if (input.signingKey.asymmetricKeyType !== 'rsa') {
    throw new Error('A SAML request is signed with an RSA key only.');
  }
  const url = new URL(input.ssoUrl);
  for (const name of PARAMETERS) url.searchParams.delete(name);
  const deflated = deflateRawSync(Buffer.from(authnRequestXml(input), 'utf8')).toString('base64');
  const pairs: readonly (readonly [string, string])[] = [
    ['SAMLRequest', deflated],
    ['RelayState', input.relayState],
    ['SigAlg', SIG_ALG],
  ];
  const signed = pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  const signature = sign('sha256', Buffer.from(signed, 'utf8'), input.signingKey);
  const query = `${signed}&Signature=${encodeURIComponent(signature.toString('base64'))}`;
  url.search = url.search === '' ? query : `${url.search.slice(1)}&${query}`;
  return url.href;
}
