// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The anonymous routes' handlers (ADR 0036, ADR 0019): the only routes that
// write personal data with no session. They set no tenant, open no tenant
// transaction and take no session or cookie; the database resolves the
// tenant from the slug inside its two approved functions. Every not-found
// case is one 404. Submitting runs in ADR 0036's order: the client limit,
// the proof (verified, then spent at once), the form and tenant limits, the
// form read, the cleaning and checking of answers against the version that
// read returned, then the keyed hashes and the function. Only cleaned
// answers and hashes reach it, and nothing here logs an answer, token, key,
// proof or address.

import {
  cleanAnswers,
  formDefinitionSchema,
  validateAnswers,
} from '@pixel-scientists/domain/forms';
import { messages } from '@pixel-scientists/domain/platform';

import {
  submitPublicResponse,
  type PublicForm,
  type PublicResponseInput,
} from '../../contracts/index.ts';
import {
  publicFormBuckets,
  type PublicArgs,
  type PublicDependencies,
  type PublicFormBucket,
  type SubmitArgs,
} from './context.ts';
import { keyHash, requestHash, tokenHash } from './hash.ts';
import { issueChallenge, verifyProof } from './proof.ts';

interface FormParams {
  readonly slug: string;
  readonly formId: string;
}

/** Postgres reads a uuid in any case, so one form must have one spelling everywhere it is keyed or bound. */
const canonical = ({ slug, formId }: FormParams): FormParams => ({
  slug,
  formId: formId.toLowerCase(),
});

/** The route id the key and request hashes are scoped to. */
const SUBMIT_ROUTE = `${submitPublicResponse.method} ${submitPublicResponse.path}`;

export function publicHandlers(deps: PublicDependencies) {
  const now = deps.now ?? (() => new Date());

  async function count(bucket: PublicFormBucket, key: string): Promise<void> {
    const { count: seen, retryAfter } = await deps.limits.count(
      bucket,
      key,
      publicFormBuckets[bucket].windowSeconds,
    );
    if (seen > publicFormBuckets[bucket].max) throw deps.slowDown(retryAfter);
  }

  /** The form and its definition, or the problem a caller gets for it. */
  async function readForm(slug: string, formId: string, formVersionId: string | null) {
    const found = await deps.forms.read(slug, formId, formVersionId);
    if (found.code !== 'ok') {
      throw found.code === 'not_found' ? deps.notFound() : deps.problem('form_changed');
    }
    const definition = formDefinitionSchema.safeParse(found.form.definition);
    if (!definition.success) throw new Error('A published form version does not parse.');
    return { ...found.form, definition: definition.data };
  }

  async function getPublicFormHandler({
    input: { params },
  }: PublicArgs<{ params: FormParams }>): Promise<PublicForm> {
    const { slug, formId } = canonical(params);
    const form = await readForm(slug, formId, null);
    const { noProof } = await deps.settings();
    return {
      formId: form.formId,
      formVersionId: form.formVersionId,
      title: form.title,
      description: form.description ?? '',
      definition: form.definition,
      noProofFallback: noProof,
    };
  }

  async function getProofChallengeHandler({
    input: { params },
    client,
  }: PublicArgs<{ params: FormParams }>): Promise<{
    challenge: string;
    difficulty: number;
    expiresAt: string;
  }> {
    const binding = canonical(params);
    await count('public_form_challenge', client);
    await readForm(binding.slug, binding.formId, null);
    const { difficulty } = await deps.settings();
    const issued = await issueChallenge(deps.keys.proof, binding, difficulty, now());
    return {
      challenge: issued.challenge,
      difficulty: issued.difficulty,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  /** The verified proof's hash, spent; null for a response sent without one while the fallback is open. */
  async function spendProof(
    proof: PublicResponseInput['proof'],
    { slug, formId }: FormParams,
    client: string,
  ): Promise<Buffer | null> {
    if (proof === null) {
      if (!(await deps.settings()).noProof) throw deps.problem('proof_invalid');
      await count('public_form_no_proof', client);
      return null;
    }
    const verified = await verifyProof(deps.keys.proof, proof, { slug, formId }, now());
    if (verified === null || !(await deps.proofs.claim(verified.proofHash, verified.issuedAt))) {
      deps.refused({ code: 'proof_invalid', client });
      throw deps.problem('proof_invalid');
    }
    return verified.proofHash;
  }

  async function submitPublicResponseHandler({
    context,
    input: { params: requested, body },
    client,
    idempotencyKey,
  }: SubmitArgs<{ params: FormParams; body: PublicResponseInput }>): Promise<{
    responseId: string;
    confirmationMessage: string;
  }> {
    const params = canonical(requested);
    await count('public_form_submit', client);
    const proofHash = await spendProof(body.proof, params, client);
    const checked = proofHash !== null;
    await count(checked ? 'public_form' : 'public_form_no_proof_form', params.formId);
    await count(checked ? 'public_form_tenant' : 'public_form_no_proof_tenant', params.slug);

    const form = await readForm(params.slug, params.formId, body.formVersionId);
    const answers = cleanAnswers(form.definition, body.answers);
    const problems = validateAnswers(form.definition, answers, 'submit');
    if (problems.length > 0) throw deps.refuse(messages.fixFields, problems);

    const result = await deps.forms.submit({
      slug: params.slug,
      formId: params.formId,
      formVersionId: form.formVersionId,
      answers,
      tokenHash: await tokenHash(deps.keys.hash, body.respondentToken),
      keyHash: await keyHash(deps.keys.hash, SUBMIT_ROUTE, body.respondentToken, idempotencyKey),
      requestHash: await requestHash({
        routeId: SUBMIT_ROUTE,
        params,
        formVersionId: form.formVersionId,
        answers,
      }),
      proofHash,
      requestId: context.requestId,
    });
    switch (result.code) {
      case 'ok':
        return { responseId: result.responseId, confirmationMessage: form.confirmationMessage };
      case 'not_found':
        throw deps.notFound();
      case 'form_changed':
        throw deps.problem('form_changed');
      case 'proof_used':
        throw deps.problem('proof_invalid');
      case 'key_reused':
        throw deps.problem('key_reused');
      case 'in_progress':
        throw deps.problem('key_in_progress');
    }
  }

  return {
    getPublicForm: getPublicFormHandler,
    getProofChallenge: getProofChallengeHandler,
    submitPublicResponse: submitPublicResponseHandler,
  };
}
