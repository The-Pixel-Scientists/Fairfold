// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Plain words for an audit action code, built from the code itself so a new
// code never shows raw: `grants.decision.released` is "Decision released".
// A tenant's copy of an auth event (`platform.auth.<event>`) is named by its
// event alone.

import { auditActionPattern } from '../audit.ts';

/** Words written differently from their code. */
const words: Readonly<Record<string, string>> = {
  mfa: 'MFA',
  'sign in': 'sign-in',
  'step up': 'step-up',
};

const WORDS = new RegExp(String.raw`\b(?:${Object.keys(words).join('|')})\b`, 'g');

/** "Decision released" for `grants.decision.released`. A string that is not a code is returned as it is. */
export function auditActionLabel(code: string): string {
  if (!auditActionPattern.test(code)) return code;
  const [, entity, event] = code.split('.') as [string, string, string];
  const name = code.startsWith('platform.auth.') ? event : `${entity}_${event}`;
  const text = name.replaceAll('_', ' ').replace(WORDS, (word) => words[word] ?? word);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
