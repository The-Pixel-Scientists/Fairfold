// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email-first sign-up (ADR 0010, "Accounts, memberships and invitations").
// Starting one answers the same for every address and never waits: the
// lookup and the email happen after the response. A new address gets a
// single-use link, kept only as its token's hash for 24 hours, which a new
// request replaces; an address with an account gets an offer to sign in or
// reset the password instead. The link opens a page that changes nothing.
// Its POST spends the token and creates the verified account with its
// password in one transaction, and does not sign the person in. A token that
// is not live is refused before the password is hashed, so a made-up one
// costs one indexed read, not a hash.

import { createHash } from 'node:crypto';

import {
  chargeRateLimits,
  EMAIL_SCOPES,
  publicTenant,
  type Kysely,
  type PublicTenantRow,
  type RateLimitClient,
} from '@pixel-scientists/db';
import { completeSignUp, startSignUp } from '@pixel-scientists/domain/auth';
import { messages, productName, type App } from '@pixel-scientists/domain/platform';

import type { RequestContext } from '../context.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { newToken } from './cookies.ts';
import { recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { hashPassword, isCommonPassword } from './passwords.ts';
import type { RouteDependencies } from './routes.ts';
import type { AuthTables } from './tables.ts';

/** A sign-up link's verification value is this prefix and the address. */
const SIGN_UP = 'sign_up:';
const LINK_MS = 24 * 3600_000;

const COMMON_PASSWORD =
  'This password is too common, so it is easy to guess. Choose another, such as a few words together.';

/** The app the request resolved to; the auth hook has refused any other host. */
export function appOf(context: RequestContext): App {
  if (context.app === null) throw new ApiError(404, undefined, { reason: 'unknown_host' });
  return context.app;
}

/** The active tenant a slug names, or the same 404 for any other slug. */
export async function tenantOf(db: Kysely<unknown>, slug: string): Promise<PublicTenantRow> {
  const tenant = await publicTenant(db, slug);
  if (tenant === undefined) throw new ApiError(404, undefined, { reason: 'unknown_tenant' });
  return tenant;
}

/** Where an app's pages for a tenant start, such as https://apply.example.org/northfield. */
function tenantBase(deps: RouteDependencies, app: App, slug: string): string {
  const prefix = app === 'console' ? (deps.settings.consolePathPrefix ?? '') : '';
  return `${deps.settings.origins[app]}${prefix}/${slug}`;
}

/** A token's verification identifier: its SHA-256 in unpadded base64url. */
const tokenId = (token: string) => createHash('sha256').update(token, 'utf8').digest('base64url');

/** A 429 with Retry-After. */
export function tooMany(deps: RouteDependencies, requestId: string, seconds: number): ApiError {
  deps.setHeader(requestId, 'retry-after', String(seconds));
  return new ApiError(429, undefined, { reason: 'rate_limited' });
}

/** Count an email to an address against ADR 0010's limits, or refuse it. */
async function limitEmails(deps: RouteDependencies, requestId: string, client: RateLimitClient) {
  const charged = await chargeRateLimits(deps.auth, EMAIL_SCOPES, client, (trx, reached) =>
    Promise.all(
      reached.map((scope) =>
        recordAuthEvent(trx, 'rate_limit_reached', { requestId, ...client, reason: scope }),
      ),
    ),
  );
  if (charged.refused) throw tooMany(deps, requestId, charged.retryAfter);
}

interface SignUpEmail {
  readonly app: App;
  readonly slug: string;
  readonly tenant: PublicTenantRow;
  readonly email: string;
  readonly requestId: string;
}

/** Issue a link for the address, replacing any pending one. */
async function newLink(deps: RouteDependencies, { app, slug, email }: SignUpEmail) {
  const token = newToken();
  const value = `${SIGN_UP}${email}`;
  await deps.auth.transaction().execute(async (trx) => {
    const db = trx.$extendTables<AuthTables>();
    await db
      .selectNoFrom((eb) =>
        eb.fn('pg_advisory_xact_lock', [eb.fn('hashtext', [eb.val(value)])]).as('locked'),
      )
      .execute();
    await db.deleteFrom('auth.verification').where('value', '=', value).execute();
    await db
      .insertInto('auth.verification')
      .values({ identifier: tokenId(token), value, expires_at: new Date(Date.now() + LINK_MS) })
      .execute();
  });
  return `${tenantBase(deps, app, slug)}/sign-up/complete#token=${token}`;
}

async function sendSignUpEmail(deps: RouteDependencies, job: SignUpEmail): Promise<void> {
  const existing = await deps.auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.user')
    .select('id')
    .where('email', '=', job.email)
    .executeTakeFirst();
  const base = tenantBase(deps, job.app, job.slug);
  const tenant = job.tenant.name;
  const email =
    existing === undefined
      ? {
          subject: `Finish creating your ${productName} account`,
          paragraphs: [
            `You asked to create a ${productName} account to use with ${tenant}.`,
            'To choose your password and finish, open this link within 24 hours:',
            await newLink(deps, job),
            'The link works once. If you did not ask for an account, ignore this email. Nobody can use your email address without this link.',
          ],
        }
      : {
          subject: `You already have a ${productName} account`,
          paragraphs: [
            `Someone asked to create a ${productName} account for ${tenant} with this email address. You already have an account, so you do not need another.`,
            `To sign in, go to:\n${base}/sign-in`,
            `If you have forgotten your password, reset it here:\n${base}/forgot-password`,
            'If you did not ask for this, ignore this email. Your account has not changed.',
          ],
        };
  if (deps.sender === undefined) {
    deps.log.error(
      { requestId: job.requestId },
      'No mail sender is set: a sign-up email was not sent',
    );
    return;
  }
  await deps.sender.send({
    to: job.email,
    subject: email.subject,
    text: email.paragraphs.join('\n\n'),
    requestId: job.requestId,
  });
}

export function signUpRoutes(deps: RouteDependencies): Route[] {
  return [
    route(startSignUp, async ({ context, input }) => {
      const app = appOf(context);
      const { slug } = input.params;
      const tenant = await tenantOf(deps.auth, slug);
      const { email } = input.body;
      await limitEmails(deps, context.requestId, {
        identifier: deps.keepIdentifier(email),
        ip: plainAddress(deps.client(context.requestId).ip),
      });
      const job = { app, slug, tenant, email, requestId: context.requestId };
      deps.later(() => sendSignUpEmail(deps, job));
      return undefined;
    }),

    route(completeSignUp, async ({ context, input }) => {
      const { token, password } = input.body;
      const ip = plainAddress(deps.client(context.requestId).ip);
      if (deps.commonPasswords === undefined) {
        throw new ApiError(503, undefined, { reason: 'no_common_password_list' });
      }
      const linkNotValid = new ApiError(400, messages.linkNotValid, { reason: 'link_not_valid' });
      const live = await deps.auth
        .$extendTables<AuthTables>()
        .selectFrom('auth.verification')
        .select('identifier')
        .where('identifier', '=', tokenId(token))
        .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(SIGN_UP)]), '=', true))
        .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
        .executeTakeFirst();
      if (live === undefined) throw linkNotValid;
      if (isCommonPassword(deps.commonPasswords, password)) {
        throw new ApiError(400, messages.fixFields, {
          errors: [{ field: 'body.password', message: COMMON_PASSWORD }],
          reason: 'common_password',
        });
      }
      const hash = await hashPassword(password);
      // The link is spent even when the address already has an account, so it never costs a second hash.
      const created = await deps.auth.transaction().execute(async (trx) => {
        const db = trx.$extendTables<AuthTables>();
        const spent = await db
          .deleteFrom('auth.verification')
          .where('identifier', '=', tokenId(token))
          .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(SIGN_UP)]), '=', true))
          .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
          .returning('value')
          .executeTakeFirst();
        if (spent === undefined) throw linkNotValid;
        await db.deleteFrom('auth.verification').where('value', '=', spent.value).execute();
        const email = spent.value.slice(SIGN_UP.length);
        const user = await db
          .insertInto('auth.user')
          .values({ email, email_verified: true })
          .onConflict((conflict) => conflict.column('email').doNothing())
          .returning('id')
          .executeTakeFirst();
        if (user === undefined) return false;
        await db
          .insertInto('auth.account')
          .values({
            user_id: user.id,
            account_id: user.id,
            provider_id: 'credential',
            password: hash,
          })
          .execute();
        await recordAuthEvent(trx, 'account_created', {
          requestId: context.requestId,
          userId: user.id,
          identifier: email,
          ip,
        });
        return true;
      });
      if (!created) throw linkNotValid;
      return undefined;
    }),
  ];
}
