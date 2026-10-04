// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What may reach a log line (ADR 0004, "Identity, URLs and logs"):
//
//   - Credentials never do. A key that contains a word such as `password`,
//     `token` or `secret` is censored, so `smtpPassword` and `csrfToken` are too.
//   - Personal data never does. A key is split into words at case changes and
//     punctuation, and censored if it holds a personal word or phrase: `email`,
//     `ip`, `first name` and the rest below, or a column the field
//     classification map (packages/db/classification.ts) marks as personal or
//     special category. So `userEmail`, `clientIP` and `contact_phone` are
//     censored, and `relationship` is not.
//   - An error found in a logged object is described by serializeError().

import { classification, type ClassificationRegistry } from '@pixel-scientists/db/classification';

import { Secret } from './config.ts';
import { isError, serializeError } from './serialize-error.ts';

export const CENSOR = '[redacted]';

/** Split a key into lower-case words at case changes and punctuation: `clientIP` is `client ip`. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A key containing one of these is a credential, even inside a longer word. */
const CREDENTIAL_WORDS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'accesskey',
  'credential',
  'cookie',
  'authorization',
  'signature',
  'jwt',
  'assertion',
  'bearer',
];

/**
 * Words and phrases that are sensitive wherever they appear in a key. Left
 * out on purpose: generic words such as `name`, `code` and `state`, which are
 * mostly not personal. A `name` column the map marks as personal is censored
 * through the map.
 */
const SENSITIVE_PHRASES = [
  'otp',
  'totp',
  'backup code',
  'recovery code',
  'session id',
  // Who the caller is and where they came from (ADR 0010 treats IPs as personal).
  'ip',
  'forwarded',
  'referer',
  'referrer',
  'user agent',
  'email',
  'first name',
  'last name',
  'full name',
  'given name',
  'family name',
  'display name',
  'phone',
  'telephone',
  'mobile',
  'address',
  'postcode',
  'date of birth',
  // Free text people write.
  'answers',
  'body',
];

/** Whether a key names a credential or personal data, and so its value may not be logged. */
export function sensitiveKeyMatcher(
  registry: ClassificationRegistry = classification,
): (key: string) => boolean {
  const phrases = new Set(SENSITIVE_PHRASES);
  for (const columns of Object.values(registry)) {
    for (const [column, field] of Object.entries(columns)) {
      if (field.sensitivity === 'personal' || field.sensitivity === 'special_category') {
        phrases.add(words(column).join(' '));
      }
    }
  }
  phrases.delete('');
  // Padded, so a phrase matches whole words: `ip` is in `client ip`, not in `relationship`.
  const padded = [...phrases].map((phrase) => ` ${phrase} `);

  return (key) => {
    const parts = words(key);
    const joined = parts.join('');
    const spaced = ` ${parts.join(' ')} `;
    return (
      // The From header holds an email address. Alone, it would also take `validFrom`.
      joined === 'from' ||
      CREDENTIAL_WORDS.some((word) => joined.includes(word)) ||
      padded.some((phrase) => spaced.includes(phrase))
    );
  };
}

const MAX_DEPTH = 6;

function redactValue(
  value: unknown,
  isSensitive: (key: string) => boolean,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (isError(value)) return serializeError(value);
  if (value instanceof Secret) return CENSOR;
  if (value instanceof Date) return value;
  if (ancestors.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';

  ancestors.add(value);
  try {
    // An object that writes itself differently, such as a Buffer or a URL, is
    // redacted as what it writes. One that returns itself is walked as it is.
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    const written = typeof toJSON === 'function' ? toJSON.call(value) : value;
    if (written !== value) return redactValue(written, isSensitive, depth + 1, ancestors);

    if (Array.isArray(value)) {
      return value.map((item: unknown) => redactValue(item, isSensitive, depth + 1, ancestors));
    }
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // A function is not logged, and a `toJSON` among them would write the original object.
      if (typeof item === 'function') continue;
      copy[key] = isSensitive(key) ? CENSOR : redactValue(item, isSensitive, depth + 1, ancestors);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Redact the object of a log call, whatever its depth. Keys in `skip` are
 * left for the logger's own serialisers (`req`, `res` and `err`), which
 * decide for themselves what to write.
 */
export function redactLogObject(
  object: Record<string, unknown>,
  isSensitive: (key: string) => boolean,
  skip: readonly string[],
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (skip.includes(key)) {
      copy[key] = value;
    } else if (isSensitive(key)) {
      copy[key] = CENSOR;
    } else {
      copy[key] = redactValue(value, isSensitive, 1, new WeakSet());
    }
  }
  return copy;
}
