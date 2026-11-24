// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the anonymous form routes read from the platform (ADR 0036, ADR 0019):
// the database's two approved functions, the request limits' counters, the
// single-use marker for a spent proof, and the problems the routes send. No
// tenant is set on the connection: the functions resolve the tenant from the
// slug inside themselves. The counters and the marker live in
// `app.request_limit`'s `public` bucket, told apart by the label inside a key
// that is an HMAC under the forms hash key, so the table holds no address,
// slug, form id or proof in clear.

import { createHmac } from 'node:crypto';

import { setLocalLockTimeout } from '@pixel-scientists/db';
import type { AppRequestLimit } from '@pixel-scientists/db/generated/app';
import { idempotencyProblems, type ProblemType } from '@pixel-scientists/domain/api';
import { publicFormProblems } from '@pixel-scientists/forms/contracts';
import type {
  PublicDependencies,
  PublicProblem,
  PublicRead,
  SubmitResult,
} from '@pixel-scientists/forms/server';

import type { ModuleSettings } from '../config.ts';
import { ApiError } from '../problems.ts';
import type { PublicLog } from '../public/tenants.ts';
import type { ModuleDatabase, PlatformHelpers } from './types.ts';

/** SQLSTATE when a statement gives up waiting for a lock. */
const LOCK_NOT_AVAILABLE = '55P03';

interface Kind {
  readonly type: ProblemType;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

function problemOf(
  { type, status, title, detail }: Kind,
  reason: string,
  headers?: Record<string, string>,
): Error {
  return new ApiError(status, detail, { reason, kind: { type, title }, headers });
}

export const publicProblems: Record<PublicProblem, () => Error> = {
  form_changed: () => problemOf(publicFormProblems.formChanged, 'form_changed'),
  proof_invalid: () => problemOf(publicFormProblems.proofInvalid, 'proof_invalid'),
  key_reused: () => problemOf(idempotencyProblems.reused, 'key_reused'),
  key_in_progress: () =>
    problemOf(idempotencyProblems.inProgress, 'key_in_progress', {
      'Retry-After': String(idempotencyProblems.inProgress.retryAfterSeconds),
    }),
};

/** The columns `forms.public_form()` answers with. */
interface PublicFormRow {
  code: string;
  form_id: string | null;
  form_version_id: string | null;
  title: string | null;
  description: string | null;
  confirmation_message: string | null;
  definition: unknown;
}

const bytes = (secret: { reveal(): string }): Uint8Array => Buffer.from(secret.reveal(), 'utf8');

export function formsPublicDependencies(
  { pool, requestLimits }: ModuleDatabase,
  platform: Pick<PlatformHelpers, 'notFound' | 'refuse'>,
  forms: NonNullable<ModuleSettings['forms']>,
  log: PublicLog | undefined,
): PublicDependencies {
  const hashKey = bytes(forms.hashKey);
  const key = (label: string, value: string | Buffer): Buffer =>
    createHmac('sha256', hashKey).update(`${label}\0`).update(value).digest();
  const limits = () =>
    pool.$extendTables<{
      'app.request_limit': AppRequestLimit;
    }>();

  return {
    notFound: platform.notFound,
    refuse: (detail, errors) => platform.refuse(400, detail, errors),
    problem: (kind) => publicProblems[kind](),
    slowDown: (retryAfterSeconds) =>
      new ApiError(429, undefined, {
        reason: 'public_form_limit',
        headers: { 'Retry-After': String(retryAfterSeconds) },
      }),

    forms: {
      async read(slug, formId, formVersionId): Promise<PublicRead> {
        const row = await pool
          .selectFrom((eb) =>
            eb
              .fn<PublicFormRow>('forms.public_form', [
                eb.val(slug),
                eb.val(formId),
                formVersionId === null ? eb.cast(eb.val(null), 'uuid') : eb.val(formVersionId),
              ])
              .as('found'),
          )
          .selectAll()
          .executeTakeFirst();
        if (row?.code === 'ok') {
          return {
            code: 'ok',
            form: {
              formId: row.form_id ?? formId,
              formVersionId: row.form_version_id ?? '',
              title: row.title ?? '',
              description: row.description,
              confirmationMessage: row.confirmation_message ?? '',
              definition: row.definition,
            },
          };
        }
        return { code: row?.code === 'form_changed' ? 'form_changed' : 'not_found' };
      },

      async submit(submission): Promise<SubmitResult> {
        try {
          return await pool.transaction().execute(async (trx) => {
            await setLocalLockTimeout(trx, '5s');
            const row = await trx
              .selectFrom((eb) =>
                eb
                  .fn<{ response_id: string | null; code: string | null }>(
                    'forms.submit_public_response',
                    [
                      eb.val(submission.slug),
                      eb.val(submission.formId),
                      eb.val(submission.formVersionId),
                      eb.cast(eb.val(JSON.stringify(submission.answers)), 'jsonb'),
                      eb.val(submission.tokenHash),
                      eb.val(submission.keyHash),
                      eb.val(submission.requestHash),
                      submission.proofHash === null
                        ? eb.cast(eb.val(null), 'bytea')
                        : eb.val(submission.proofHash),
                      eb.val(submission.requestId),
                    ],
                  )
                  .as('result'),
              )
              .selectAll()
              .executeTakeFirstOrThrow();
            if (row.response_id !== null) return { code: 'ok', responseId: row.response_id };
            return { code: row.code as Exclude<SubmitResult['code'], 'ok'> };
          });
        } catch (error) {
          if ((error as { code?: unknown }).code === LOCK_NOT_AVAILABLE) {
            return { code: 'in_progress' };
          }
          throw error;
        }
      },
    },

    limits: {
      count: (bucket, subject, windowSeconds) =>
        requestLimits.count('public', key(`forms.limit.${bucket}`, subject), windowSeconds),
    },

    proofs: {
      async claim(proofHash, issuedAt) {
        const claimed = await limits()
          .insertInto('app.request_limit')
          .values({
            bucket: 'public',
            key_hash: key('forms.proof', proofHash),
            window_start: issuedAt,
            count: 1,
          })
          .onConflict((conflict) => conflict.doNothing())
          .returning('count')
          .executeTakeFirst();
        return claimed !== undefined;
      },
    },

    settings: () => Promise.resolve({ difficulty: forms.difficulty, noProof: forms.noProof }),
    keys: { proof: bytes(forms.proofKey), hash: hashKey },
    refused: ({ code, client }) => {
      log?.warn({ code, client }, 'A public form refused a browser check');
    },
  };
}
