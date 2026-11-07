// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one list of attributes that may leave the process, on spans and on
// metrics. Anything else is dropped, so a new label cannot carry personal data
// by accident. Values are closed too: each is checked against its own rule,
// and a value that fails is replaced by a fixed word, never passed on.

import type { Attributes } from '@opentelemetry/api';

export const APPS = ['console', 'portal', 'none'] as const;
export type TelemetryApp = (typeof APPS)[number];

/** The closed list of rate limits. S11-36 adds its limits here. */
export const RATE_LIMITS = [
  'sign_in',
  'sign_up',
  'password_reset',
  'mfa',
  'upload',
  'export',
  'public',
  'api',
] as const;
export type RateLimitName = (typeof RATE_LIMITS)[number];

export const MFA_FACTORS = ['totp', 'recovery_code', 'passkey', 'email_code'] as const;
export type MfaFactor = (typeof MFA_FACTORS)[number];

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
/** A route template: path segments and `:name` parameters, never a value. */
const ROUTE = /^\/[A-Za-z0-9_:/*.{}-]{0,200}$/;

interface Rule {
  readonly ok: (value: unknown) => boolean;
  readonly fallback: string | number;
}

const name = (fallback: string): Rule => ({
  ok: (value) => typeof value === 'string' && NAME.test(value),
  fallback,
});
const oneOf = (list: readonly string[], fallback: string): Rule => ({
  ok: (value) => typeof value === 'string' && list.includes(value),
  fallback,
});

const RULES: Readonly<Record<string, Rule>> = {
  'http.request.method': oneOf(METHODS, 'OTHER'),
  'http.route': {
    ok: (value) => typeof value === 'string' && ROUTE.test(value),
    fallback: 'unmatched',
  },
  'http.response.status_code': {
    ok: (value) => Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599,
    fallback: 0,
  },
  'tps.app': oneOf(APPS, 'none'),
  'tps.module': name('none'),
  'tps.problem_type': name('unknown'),
  'tps.queue': name('other'),
  'tps.error_code': name('unknown'),
  'tps.rate_limit': oneOf(RATE_LIMITS, 'other'),
  'tps.mfa_factor': oneOf(MFA_FACTORS, 'other'),
};

export const ALLOWED_ATTRIBUTES: readonly string[] = Object.keys(RULES);

/** Only the allowed keys, each with a value that passes its rule. */
export function allowedAttributes(attributes: Readonly<Record<string, unknown>>): Attributes {
  const result: Attributes = {};
  for (const [key, rule] of Object.entries(RULES)) {
    if (!(key in attributes)) continue;
    const value = attributes[key];
    result[key] = rule.ok(value) ? (value as string | number) : rule.fallback;
  }
  return result;
}
