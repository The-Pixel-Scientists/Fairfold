// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking for a password reset link (ADR 0010). The request answers the same
// for every address and never waits: the lookup, the link and the email
// happen after the response, and only an active account with a password
// gets a link. Its token is 256 random bits, kept only as its SHA-256 for
// 30 minutes, and travels in the URL fragment of the reset page of the app
// and tenant it was asked from. Links are not replaced: once one completes,
// every other link of the account dies (password-reset-complete.ts).
//
// Better Auth's reset is not used: it spends a token with a read and then a
// delete, so two completions can both pass, and it leaves the account's
// other links alive.
//
// The events carry the tenant the link names, so they wait for the replay
// command to copy them: with no session, nothing here gives a trusted tenant
// (ADR 0003, "Tenant context and queries").

import { requestPasswordReset } from '@pixel-scientists/domain/auth';
import { productName, type App } from '@pixel-scientists/domain/platform';

import { route, type Route } from '../routes/register.ts';
import { newToken } from './cookies.ts';
import { recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import type { RouteDependencies } from './routes.ts';
import { appOf, limitEmails, tenantBase, tenantOf, tokenId } from './sign-up.ts';
import type { AuthTables } from './tables.ts';

/** A reset link's verification value is this prefix, the user's id and the tenant's id. */
export const RESET = 'password_reset:';
export const VALUE = /^password_reset:([0-9a-f-]{36}):([0-9a-f-]{36})$/;
const LINK_MS = 30 * 60_000;

interface ResetRequest {
  readonly app: App;
  readonly slug: string;
  readonly tenant: { readonly id: string; readonly name: string };
  readonly email: string;
  readonly identifier: string;
  readonly ip: string;
  readonly requestId: string;
}

/** Send an auth email, or log that none could be sent. */
export async function sendResetEmail(
  deps: RouteDependencies,
  requestId: string,
  to: string,
  subject: string,
  paragraphs: string[],
) {
  if (deps.sender === undefined) {
    deps.log.error({ requestId }, 'No mail sender is set: a password reset email was not sent');
    return;
  }
  await deps.sender.send({ to, subject, text: paragraphs.join('\n\n'), requestId });
}

/** Record the request and, for an active account with a password, issue and email a link. */
async function sendResetLink(deps: RouteDependencies, job: ResetRequest): Promise<void> {
  const account = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.user as u')
    .innerJoin('auth.account as a', 'a.user_id', 'u.id')
    .select('u.id')
    .where('u.email', '=', job.email)
    .where('u.status', '=', 'active')
    .where('a.provider_id', '=', 'credential')
    .executeTakeFirst();
  const details = {
    requestId: job.requestId,
    tenant: job.tenant.id,
    identifier: job.identifier,
    ip: job.ip,
  };
  if (account === undefined) {
    await deps.auth
      .transaction()
      .execute((trx) => recordAuthEvent(trx, 'password_reset_requested', details));
    return;
  }
  const token = newToken();
  await deps.auth.transaction().execute(async (trx) => {
    await trx
      .$extendTables<AuthTables>()
      .insertInto('auth.verification')
      .values({
        identifier: tokenId(token),
        value: `${RESET}${account.id}:${job.tenant.id}`,
        expires_at: new Date(Date.now() + LINK_MS),
      })
      .execute();
    await recordAuthEvent(trx, 'password_reset_requested', { ...details, userId: account.id });
  });
  await sendResetEmail(deps, job.requestId, job.email, `Reset your ${productName} password`, [
    `You asked to reset the password for your ${productName} account, to use with ${job.tenant.name}.`,
    'To choose a new password, open this link within 30 minutes:',
    `${tenantBase(deps, job.app, job.slug)}/reset-password#token=${token}`,
    'The link works once. If you did not ask to reset your password, ignore this email. Your password has not changed.',
  ]);
}

export function requestResetRoute(deps: RouteDependencies): Route {
  return route(requestPasswordReset, async ({ context, input }) => {
    const app = appOf(context);
    const { slug } = input.params;
    const tenant = await tenantOf(deps.auth, slug);
    const { email } = input.body;
    const job = {
      app,
      slug,
      tenant,
      email,
      identifier: deps.keepIdentifier(email),
      ip: plainAddress(deps.client(context.requestId).ip),
      requestId: context.requestId,
    };
    await limitEmails(deps, context.requestId, { identifier: job.identifier, ip: job.ip });
    deps.later(() => sendResetLink(deps, job));
    return undefined;
  });
}
