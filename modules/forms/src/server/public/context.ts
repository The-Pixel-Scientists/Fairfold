// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the anonymous routes read from the platform (ADR 0016, ADR 0036). The
// module never imports from the API: the API passes in the database's two
// approved functions, the limits' counters, the server keys and the problems
// it sends. No port takes a tenant id, and nothing here sets one: the tenant
// is resolved inside the database, from the slug.

import type { Answers } from '@pixel-scientists/domain/forms';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

/** The form `forms.public_form()` found, as the database holds it. */
export interface PublicFormRecord {
  readonly formId: string;
  /** The version whose definition this is: the one the response pins. */
  readonly formVersionId: string;
  readonly title: string;
  readonly description: string | null;
  readonly confirmationMessage: string;
  /** Parsed by the handler, never trusted as stored. */
  readonly definition: unknown;
}

/** `forms.public_form()`'s answer; every not-found case is one code. */
export type PublicRead =
  | { readonly code: 'not_found' | 'form_changed' }
  | { readonly code: 'ok'; readonly form: PublicFormRecord };

/** What goes to `forms.submit_public_response()`: hashes and cleaned answers, never the raw key or token. */
export interface PublicSubmission {
  readonly slug: string;
  readonly formId: string;
  readonly formVersionId: string;
  readonly answers: Answers;
  readonly tokenHash: Buffer;
  readonly keyHash: Buffer;
  readonly requestHash: Buffer;
  /** Null for a response sent without the browser check. */
  readonly proofHash: Buffer | null;
  readonly requestId: string;
}

export type SubmitResult =
  | { readonly code: 'ok'; readonly responseId: string }
  | {
      readonly code: 'not_found' | 'form_changed' | 'key_reused' | 'proof_used' | 'in_progress';
    };

/** The limits' buckets this module counts (ADR 0036), each a fixed window and ceiling. */
export const publicFormBuckets = {
  public_form_challenge: { windowSeconds: 3600, max: 60 },
  public_form_submit: { windowSeconds: 3600, max: 10 },
  public_form_no_proof: { windowSeconds: 3600, max: 2 },
  public_form: { windowSeconds: 3600, max: 300 },
  public_form_tenant: { windowSeconds: 3600, max: 1000 },
  public_form_no_proof_form: { windowSeconds: 3600, max: 20 },
  public_form_no_proof_tenant: { windowSeconds: 3600, max: 60 },
} as const;

export type PublicFormBucket = keyof typeof publicFormBuckets;

/** The problems the platform sends besides 404, a field problem and 429. */
export type PublicProblem = 'form_changed' | 'proof_invalid' | 'key_reused' | 'key_in_progress';

export interface PublicDependencies {
  /** A failure that reads exactly as an unknown tenant or form does. */
  readonly notFound: () => Error;
  /** A 400 listing the fields at fault, by field id. */
  readonly refuse: (detail: string, errors: readonly FieldProblem[]) => Error;
  readonly problem: (problem: PublicProblem) => Error;
  /** A 429 with Retry-After. The platform logs the security event. */
  readonly slowDown: (retryAfterSeconds: number) => Error;
  readonly forms: {
    /** `forms.public_form(slug, form_id, form_version_id)`; null reads the latest version. */
    read(slug: string, formId: string, formVersionId: string | null): Promise<PublicRead>;
    /** `forms.submit_public_response()`, with `lock_timeout` set to 5 seconds first. */
    submit(submission: PublicSubmission): Promise<SubmitResult>;
  };
  readonly limits: {
    /** Counts one request under the key, which the platform hashes with its own key. */
    count(
      bucket: PublicFormBucket,
      key: string,
      windowSeconds: number,
    ): Promise<{ readonly count: number; readonly retryAfter: number }>;
  };
  readonly proofs: {
    /**
     * Spends a verified proof: one atomic upsert in `app.request_limit`
     * (bucket `public_form_proof`, limit 1, `window_start` the challenge's
     * issue time). True only for the first use.
     */
    claim(proofHash: Buffer, issuedAt: Date): Promise<boolean>;
  };
  /** Operator settings, read on every request. */
  readonly settings: () => Promise<{ readonly difficulty: number; readonly noProof: boolean }>;
  /** The two server keys, read through `readSecret`: one signs challenges, one keys the hashes. */
  readonly keys: { readonly proof: Uint8Array; readonly hash: Uint8Array };
  /** A refusal for the security log: a code and the client network, never the proof or an answer. */
  readonly refused: (event: { readonly code: 'proof_invalid'; readonly client: string }) => void;
  readonly now?: () => Date;
}

export interface PublicArgs<I> {
  readonly context: { readonly requestId: string };
  readonly input: I;
  /** The client network from the trusted proxy list, as the request limits count it. Never a header. */
  readonly client: string;
}

/** The submit route's validated `Idempotency-Key` header. */
export interface SubmitArgs<I> extends PublicArgs<I> {
  readonly idempotencyKey: string;
}
