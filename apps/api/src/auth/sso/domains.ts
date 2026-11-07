// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email domains an SSO provider claims (ADR 0010, "SSO"). A domain is
// normalised once, before it is stored or compared: lower case, no trailing
// dot, IDNA A-labels. Wildcards, IP literals and bare public suffixes are
// refused. A claim is proven by a TXT record holding the claim's own random
// token, so a token issued for another tenant, provider or domain proves
// nothing. The lookup goes to the system's DNS servers, never to an address
// a request names, with a fixed time limit and a cap on what is read, and
// only codes are logged.

import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { domainNameSchema } from '@pixel-scientists/domain/auth';

/** Where the record goes, under the domain. */
export const RECORD_LABEL = '_sso-verification';
/** What the record holds, before the token. */
export const RECORD_PREFIX = 'sso-verification=';

const LOOKUP_TIMEOUT_MS = 3_000;
const MAX_RECORDS = 20;
const MAX_RECORD_CHARS = 1_024;

/**
 * Registry suffixes under which anyone may register a name, beyond single
 * labels such as `org`. Not the whole public suffix list: the DNS proof is
 * what stops a claim on a suffix, and this refuses the common ones early.
 */
const PUBLIC_SUFFIXES = new Set([
  'ac.uk',
  'co.uk',
  'gov.uk',
  'ltd.uk',
  'me.uk',
  'net.uk',
  'nhs.uk',
  'org.uk',
  'plc.uk',
  'police.uk',
  'sch.uk',
  'co.nz',
  'com.au',
  'org.au',
  'co.za',
  'github.io',
]);

/** The stored form of `input`, or undefined if it is not a domain that can be claimed. */
export function normaliseDomain(input: string): string | undefined {
  const text = input.trim().toLowerCase().replace(/\.$/, '');
  if (text.includes('*') || isIP(text.replace(/^\[|\]$/g, '')) !== 0) return undefined;
  const ascii = domainToASCII(text);
  const parsed = domainNameSchema.safeParse(ascii);
  if (!parsed.success || parsed.data !== ascii || PUBLIC_SUFFIXES.has(ascii)) return undefined;
  return ascii;
}

/** A new claim's token: 32 random bytes in unpadded base64url. */
export const newDnsToken = (): string => randomBytes(32).toString('base64url');

/** The TXT record that proves a claim on `domain` with `token`. */
export const dnsRecord = (domain: string, token: string) =>
  ({ type: 'TXT', name: `${RECORD_LABEL}.${domain}`, value: `${RECORD_PREFIX}${token}` }) as const;

export type TxtLookup = (name: string) => Promise<string[][]>;

/** The system resolver, with a fixed time limit per try and two tries. */
export function systemTxtLookup(): TxtLookup {
  return (name) => new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 }).resolveTxt(name);
}

export type ProofOutcome = 'proven' | 'not_found' | 'lookup_failed';

/**
 * Whether `domain`'s TXT record holds exactly `token`. Only the claim's own
 * domain is looked up; at most MAX_RECORDS records of MAX_RECORD_CHARS are
 * read, and the whole lookup gives up after twice the per-try limit.
 */
export async function checkDnsProof(
  lookup: TxtLookup,
  domain: string,
  token: string,
): Promise<ProofOutcome> {
  let records: string[][];
  let timer: NodeJS.Timeout | undefined;
  try {
    records = await Promise.race([
      lookup(dnsRecord(domain, token).name),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, 2 * LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const { code } = error as { code?: unknown };
    return code === 'ENOTFOUND' || code === 'ENODATA' ? 'not_found' : 'lookup_failed';
  } finally {
    clearTimeout(timer);
  }
  const expected = `${RECORD_PREFIX}${token}`;
  return records
    .slice(0, MAX_RECORDS)
    .map((chunks) => chunks.join('').slice(0, MAX_RECORD_CHARS))
    .some((record) => record === expected)
    ? 'proven'
    : 'not_found';
}
