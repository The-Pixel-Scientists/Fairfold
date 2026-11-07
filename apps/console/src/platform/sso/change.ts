// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shapes and small helpers for the single sign-on settings: what the
// contracts answer, how typed text becomes the lists they take, and how a
// refusal from the server finds the field on screen it belongs to.

import { ProblemError } from '@pixel-scientists/domain/api';
import type { CallResult } from '@pixel-scientists/domain/api';
import type { addSsoDomain, getSsoProvider } from '@pixel-scientists/domain/auth';

export type Provider = CallResult<typeof getSsoProvider>;
export type Domain = Provider['domains'][number];
export type DnsRecord = CallResult<typeof addSsoDomain>['dnsRecord'];

/** One value to a line, blank lines dropped. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Every certificate in pasted text, each as its own block. */
export function certificatesIn(text: string): string[] {
  return text
    .split(/(?=-----BEGIN CERTIFICATE-----)/)
    .map((block) => block.trim())
    .filter((block) => block !== '');
}

/** The form fields the server's problem paths land on: `body.certificates.0` is `certificates`. */
const fieldOf: Record<string, string> = { 'mfa.amr': 'amr', 'mfa.acr': 'acr' };

/**
 * Gives the server's field problems the ids of this form's fields. Anything
 * else about the problem, including its words, is kept as it came.
 */
export function onFormFields(error: unknown): unknown {
  if (!(error instanceof ProblemError) || error.errors.length === 0) return error;
  return new ProblemError(error.status, error.detail, {
    type: error.type,
    ...(error.requestId === null ? {} : { requestId: error.requestId }),
    errors: error.errors.map(({ field, message }) => {
      const path = field.replace(/^body\./, '').replace(/\.\d+/g, '');
      return { field: `body.${fieldOf[path] ?? path}`, message };
    }),
  });
}
