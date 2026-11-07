// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rules every new password passes, and the account's breach state
// (ADR 0010, "Sign-in limits and passwords"): the length rule (the
// contract's), the bundled common-password list, then, unless the operator
// turned it off, the breached-password lookup. A password the service did
// not answer for is accepted and its account flagged "check pending" in the
// transaction that stores it; the next password sign-in looks it up again.
// A password found breached then must be changed before the account signs
// in: after MFA, or through an emailed reset link. A miss is logged as its
// code only; nothing derived from the password is logged or kept.

import { messages } from '@pixel-scientists/domain/platform';
import type { Transaction } from '@pixel-scientists/db';
import type { FastifyBaseLogger } from 'fastify';

import { ApiError } from '../../problems.ts';
import { verifyPassword } from '../passwords.ts';
import { refuseCommonPassword } from '../sign-up.ts';
import type { AuthTables } from '../tables.ts';
import type { BreachAnswer } from './range.ts';

export interface PasswordCheckDependencies {
  readonly settings: { readonly breachCheck: boolean };
  readonly lookUpPassword: (password: string) => Promise<BreachAnswer>;
  readonly log: FastifyBaseLogger;
}

/** The problem for a new password known from a breach, which never echoes it. */
export function breachedPassword(): ApiError {
  return new ApiError(400, messages.fixFields, {
    errors: [
      {
        field: 'body.password',
        message:
          'This password has appeared in a data breach, so others may know it. Choose another, such as a few words together.',
      },
    ],
    reason: 'breached_password',
  });
}

/** The breach check's answer, or undefined if it is off or the service did not answer. */
async function lookUp(
  deps: PasswordCheckDependencies,
  requestId: string,
  password: string,
): Promise<'breached' | 'not_breached' | undefined> {
  if (!deps.settings.breachCheck) return undefined;
  const found = await deps.lookUpPassword(password);
  if (found.answer !== 'no_answer') return found.answer;
  deps.log.warn(
    { requestId, breachCheck: found.code },
    'The breached-password check did not answer',
  );
  return undefined;
}

/**
 * Refuse a new password that is common or known from a breach. True if the
 * breach check is pending: on, but the service did not answer.
 */
export async function checkNewPassword(
  deps: PasswordCheckDependencies,
  requestId: string,
  common: ReadonlySet<string>,
  password: string,
): Promise<boolean> {
  refuseCommonPassword(common, password);
  const found = await lookUp(deps, requestId, password);
  if (found === 'breached') throw breachedPassword();
  return deps.settings.breachCheck && found === undefined;
}

/** The account's breach state for a password stored now, whose check is `pending` or not. */
export function newPasswordState(pending: boolean) {
  return { breach_check_pending_since: pending ? new Date() : null, password_breached_at: null };
}

/**
 * In `trx`, with the user locked, refuse `password` if it is the breached
 * password the account holds now, which an unanswered or disabled check
 * would otherwise let clear the flag.
 */
export async function refuseBreachedAgain(
  trx: Transaction<unknown>,
  userId: string,
  password: string,
): Promise<void> {
  const account = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.account')
    .select(['password', 'password_breached_at'])
    .where('user_id', '=', userId)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  if (account === undefined || account.password_breached_at === null) return;
  if (await verifyPassword(account.password, password)) throw breachedPassword();
}

/**
 * At a password sign-in, once the password is verified: look it up again if
 * the account's check is pending. Undefined if it is not, or still no answer.
 */
export function recheckAtSignIn(
  deps: PasswordCheckDependencies,
  requestId: string,
  pendingSince: Date | null,
  password: string,
): Promise<'breached' | 'not_breached' | undefined> {
  if (pendingSince === null) return Promise.resolve(undefined);
  return lookUp(deps, requestId, password);
}

/** Record a recheck's answer in `trx`, which has made sure the password is still the account's. */
export async function recordRecheck(
  trx: Transaction<unknown>,
  userId: string,
  answer: 'breached' | 'not_breached',
): Promise<void> {
  await trx
    .$extendTables<AuthTables>()
    .updateTable('auth.account')
    .set({
      breach_check_pending_since: null,
      ...(answer === 'breached' ? { password_breached_at: new Date() } : {}),
    })
    .where('user_id', '=', userId)
    .where('provider_id', '=', 'credential')
    .where('breach_check_pending_since', 'is not', null)
    .execute();
}
