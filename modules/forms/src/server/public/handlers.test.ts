// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { PROOF_LIFETIME_SECONDS, type PublicResponseInput } from '../../contracts/index.ts';
import { publicFormBuckets } from './context.ts';
import { publicHandlers } from './handlers.ts';
import { keyHash, requestHash, tokenHash } from './hash.ts';
import { issueChallenge } from './proof.ts';
import {
  CLIENT,
  FORM_ID,
  IDEMPOTENCY_KEY,
  KEYS,
  NOW,
  OTHER_FORM_ID,
  platform,
  REQUEST_ID,
  RESPONSE_ID,
  SLUG,
  solve,
  solved,
  TOKEN,
  VERSION_ID,
} from './testing.ts';

// Solving a browser check hashes thousands of times, slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const params = { slug: SLUG, formId: FORM_ID };
const context = { requestId: REQUEST_ID };
const ROUTE = 'POST /public/tenants/:slug/forms/:formId/responses';

async function body(overrides: Partial<PublicResponseInput> = {}): Promise<PublicResponseInput> {
  return {
    formVersionId: VERSION_ID,
    respondentToken: TOKEN,
    proof: await solved(),
    answers: { f_rating: 'good', f_comment: '   ' },
    ...overrides,
  };
}

async function send(
  handlers: ReturnType<typeof publicHandlers>,
  request?: PublicResponseInput,
  idempotencyKey = IDEMPOTENCY_KEY,
) {
  return handlers.submitPublicResponse({
    context,
    input: { params, body: request ?? (await body()) },
    client: CLIENT,
    idempotencyKey,
  });
}

const read = (handlers: ReturnType<typeof publicHandlers>) =>
  handlers.getPublicForm({ context, input: { params }, client: CLIENT });

const challenge = (handlers: ReturnType<typeof publicHandlers>) =>
  handlers.getProofChallenge({ context, input: { params }, client: CLIENT });

describe('getPublicForm', () => {
  it('gives the latest version, and says whether the fallback is open', async () => {
    const { deps, reads } = platform({ noProof: false });
    const form = await read(publicHandlers(deps));
    expect(reads).toEqual([[SLUG, FORM_ID, null]]);
    expect(form).toMatchObject({ formId: FORM_ID, formVersionId: VERSION_ID, description: '' });
    expect(form.noProofFallback).toBe(false);
  });

  it('answers the same 404 for every case the database calls not found', async () => {
    const { deps } = platform({ read: { code: 'not_found' } });
    await expect(read(publicHandlers(deps))).rejects.toThrow('not_found');
  });
});

describe('getProofChallenge', () => {
  it('issues a challenge bound to the slug and form, with the platform difficulty', async () => {
    const { deps, counted } = platform();
    const issued = await challenge(publicHandlers(deps));
    expect(issued.difficulty).toBe(8);
    expect(issued.expiresAt).toBe(
      new Date(NOW.getTime() + PROOF_LIFETIME_SECONDS * 1000).toISOString(),
    );
    expect(counted('public_form_challenge', CLIENT)).toBe(1);
  });

  it('issues nothing for a form that is not found, and still counts the request', async () => {
    const { deps, counted } = platform({ read: { code: 'not_found' } });
    await expect(challenge(publicHandlers(deps))).rejects.toThrow('not_found');
    expect(counted('public_form_challenge', CLIENT)).toBe(1);
  });

  it('refuses past the hourly limit with the time to wait', async () => {
    const handlers = publicHandlers(platform().deps);
    for (let n = 0; n < publicFormBuckets.public_form_challenge.max; n += 1) {
      await challenge(handlers);
    }
    await expect(challenge(handlers)).rejects.toThrow('slow:1800');
  });
});

describe('submitPublicResponse', () => {
  it('cleans the answers and sends the function only hashes and the version it checked', async () => {
    const { deps, submitted } = platform();
    const receipt = await send(publicHandlers(deps));
    expect(receipt).toEqual({ responseId: RESPONSE_ID, confirmationMessage: 'Thank you.' });
    expect(submitted).toHaveLength(1);
    const submission = submitted[0];
    expect(submission).toMatchObject({
      slug: SLUG,
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      answers: { f_rating: 'good', f_comment: null },
      requestId: REQUEST_ID,
    });
    expect(submission?.tokenHash).toEqual(await tokenHash(KEYS.hash, TOKEN));
    expect(submission?.keyHash).toEqual(await keyHash(KEYS.hash, ROUTE, TOKEN, IDEMPOTENCY_KEY));
    // Neither the raw key nor the raw token reaches the database.
    expect(JSON.stringify(submission)).not.toContain(TOKEN);
    expect(JSON.stringify(submission)).not.toContain(IDEMPOTENCY_KEY);
  });

  it('keys retries by token and key, and the request by its contents alone', async () => {
    const same = async (a: Promise<Buffer>, b: Promise<Buffer>) => (await a).equals(await b);
    expect(
      await same(keyHash(KEYS.hash, ROUTE, TOKEN, 'a'), keyHash(KEYS.hash, ROUTE, TOKEN, 'b')),
    ).toBe(false);
    expect(
      await same(
        keyHash(KEYS.hash, ROUTE, TOKEN, 'a'),
        keyHash(KEYS.hash, ROUTE, `${TOKEN}x`, 'a'),
      ),
    ).toBe(false);
    expect(await same(keyHash(KEYS.hash, ROUTE, TOKEN, 'a'), tokenHash(KEYS.hash, TOKEN))).toBe(
      false,
    );
    const request = { routeId: ROUTE, params, formVersionId: VERSION_ID };
    expect(
      await same(
        requestHash({ ...request, answers: { a: 1, b: { c: 2, d: 3 } } }),
        requestHash({ ...request, answers: { b: { d: 3, c: 2 }, a: 1 } }),
      ),
    ).toBe(true);

    // A retry that solved a new challenge is the same request.
    const { deps, submitted } = platform();
    const handlers = publicHandlers(deps);
    await send(handlers);
    await send(handlers, await body({ proof: await solved(params, 9) }));
    const [first, second] = submitted;
    expect(second?.requestHash).toEqual(first?.requestHash);
    expect(second?.keyHash).toEqual(first?.keyHash);
    expect(second?.proofHash).not.toEqual(first?.proofHash);
  });

  it('validates against the version it read, and pins that version', async () => {
    const { deps, reads, submitted } = platform();
    await send(publicHandlers(deps));
    expect(reads.at(-1)).toEqual([SLUG, FORM_ID, VERSION_ID]);
    expect(submitted[0]?.formVersionId).toBe(VERSION_ID);
  });

  it('answers the form-changed problem, without the function, when the read refuses the version', async () => {
    const { deps, submitted } = platform({ read: { code: 'form_changed' } });
    await expect(send(publicHandlers(deps))).rejects.toThrow('problem:form_changed');
    expect(submitted).toHaveLength(0);
  });

  it('honours the function when the form changed between the read and the write', async () => {
    const { deps } = platform({ submit: { code: 'form_changed' } });
    await expect(send(publicHandlers(deps))).rejects.toThrow('problem:form_changed');
  });

  it.each([
    ['not_found', 'not_found'],
    ['key_reused', 'problem:key_reused'],
    ['in_progress', 'problem:key_in_progress'],
    ['proof_used', 'problem:proof_invalid'],
  ] as const)('maps the function code %s', async (code, message) => {
    const { deps } = platform({ submit: { code } });
    await expect(send(publicHandlers(deps))).rejects.toThrow(message);
  });

  it('refuses answers that fail the version, by field id, and writes nothing', async () => {
    const { deps, submitted } = platform();
    const handlers = publicHandlers(deps);
    await expect(
      send(handlers, await body({ answers: { f_comment: 'No rating' } })),
    ).rejects.toThrow('refused:f_rating');
    await expect(
      send(
        handlers,
        await body({ proof: await solved(params, 9), answers: { f_rating: 'good', f_other: 'x' } }),
      ),
    ).rejects.toThrow('refused:f_other');
    expect(submitted).toHaveLength(0);
  });

  it('writes nothing for a bad, expired, mis-bound or reused proof, with one problem for all', async () => {
    const { deps, submitted, refused } = platform();
    const handlers = publicHandlers(deps);
    const good = await solved();
    const old = new Date(NOW.getTime() - 3_600_000);
    const expired = await solve((await issueChallenge(KEYS.proof, params, 8, old)).challenge, 8);
    const noSolutions = {
      ...(await solved(params, 9)),
      nonces: Array.from({ length: 16 }, () => 0),
    };
    const elsewhere = await solved({ slug: SLUG, formId: OTHER_FORM_ID });
    for (const proof of [expired, noSolutions, elsewhere]) {
      await expect(send(handlers, await body({ proof }))).rejects.toThrow('problem:proof_invalid');
    }
    await send(handlers, await body({ proof: good }));
    await expect(send(handlers, await body({ proof: good }))).rejects.toThrow(
      'problem:proof_invalid',
    );
    expect(submitted).toHaveLength(1);
    expect(refused).toHaveLength(4);
    expect(JSON.stringify(refused)).not.toContain(good.challenge);
  });

  it('refuses a request with no proof while the fallback is off', async () => {
    const { deps, submitted } = platform({ noProof: false });
    await expect(send(publicHandlers(deps), await body({ proof: null }))).rejects.toThrow(
      'problem:proof_invalid',
    );
    expect(submitted).toHaveLength(0);
  });

  it('counts a request with no proof only against the fallback buckets', async () => {
    const { deps, submitted, counted } = platform();
    await send(publicHandlers(deps), await body({ proof: null }));
    expect(submitted[0]?.proofHash).toBeNull();
    expect(counted('public_form_no_proof', CLIENT)).toBe(1);
    expect(counted('public_form_no_proof_form', FORM_ID)).toBe(1);
    expect(counted('public_form_no_proof_tenant', SLUG)).toBe(1);
    expect(counted('public_form', FORM_ID)).toBe(0);
    expect(counted('public_form_tenant', SLUG)).toBe(0);
  });

  it('allows two requests with no proof an hour from one client', async () => {
    const handlers = publicHandlers(platform().deps);
    await send(handlers, await body({ proof: null }));
    await send(handlers, await body({ proof: null }));
    await expect(send(handlers, await body({ proof: null }))).rejects.toThrow('slow:');
  });

  it('spends a proof on its first use, and counts the form and tenant once', async () => {
    const { deps, submitted, counted } = platform();
    const handlers = publicHandlers(deps);
    const proof = await solved();
    const invalid = { f_comment: 'No rating' };
    await expect(send(handlers, await body({ proof, answers: invalid }))).rejects.toThrow(
      'refused:f_rating',
    );
    for (let again = 0; again < 3; again += 1) {
      await expect(send(handlers, await body({ proof, answers: invalid }))).rejects.toThrow(
        'problem:proof_invalid',
      );
    }
    expect(counted('public_form', FORM_ID)).toBe(1);
    expect(counted('public_form_tenant', SLUG)).toBe(1);
    expect(counted('public_form_submit', CLIENT)).toBe(4);
    expect(submitted).toHaveLength(0);
  });

  it('spends one challenge once, however it is spelled or solved', async () => {
    const { deps, submitted, counted, spent } = platform();
    const handlers = publicHandlers(deps);
    const canonical = await solved();
    const [text = '', signature = ''] = canonical.challenge.split('.');
    await send(handlers, await body({ proof: canonical }));
    const copies = [
      `${text}=.${signature}`,
      `${text}.${signature}=`,
      `${text}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`,
      canonical.challenge,
    ];
    for (const copy of copies) {
      const proof = await solve(copy, 8, 50_000);
      await expect(send(handlers, await body({ proof }))).rejects.toThrow('problem:proof_invalid');
    }
    expect(spent.size).toBe(1);
    expect(counted('public_form_tenant', SLUG)).toBe(1);
    expect(submitted).toHaveLength(1);
  });

  it('refuses before the proof once a client has used its submit budget', async () => {
    const { deps, refused } = platform();
    const handlers = publicHandlers(deps);
    for (let n = 0; n < publicFormBuckets.public_form_submit.max; n += 1) {
      await send(handlers, await body({ proof: await solved(params, 8 + (n % 2)) }));
    }
    await expect(send(handlers, await body({ proof: null }))).rejects.toThrow('slow:');
    expect(refused).toHaveLength(0);
  });

  it('puts no answer, token, key or proof in a problem', async () => {
    const { deps } = platform({ submit: { code: 'key_reused' } });
    const proof = await solved();
    const request = await body({
      proof,
      answers: { f_rating: 'good', f_comment: 'My secret story' },
    });
    const error = await send(publicHandlers(deps), request).catch((caught: unknown) => caught);
    for (const secret of [TOKEN, IDEMPOTENCY_KEY, proof.challenge, 'My secret story']) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe('a form id in any letter case', () => {
  const upper = FORM_ID.toUpperCase();
  const mixed = FORM_ID.replace(/[a-f]/g, (letter, at: number) =>
    at % 2 === 0 ? letter.toUpperCase() : letter,
  );
  const spellings = [FORM_ID, upper, mixed];

  const sendAs = async (
    handlers: ReturnType<typeof publicHandlers>,
    formId: string,
    request: PublicResponseInput,
    key = IDEMPOTENCY_KEY,
  ) =>
    handlers.submitPublicResponse({
      context,
      input: { params: { slug: SLUG, formId }, body: request },
      client: CLIENT,
      idempotencyKey: key,
    });

  it('counts every spelling against one checked form bucket, and reads the form by its lowercase id', async () => {
    const { deps, counted, reads } = platform();
    const handlers = publicHandlers(deps);
    for (const formId of spellings) await sendAs(handlers, formId, await body());
    expect(counted('public_form', FORM_ID)).toBe(3);
    expect(counted('public_form', upper)).toBe(0);
    expect(counted('public_form', mixed)).toBe(0);
    expect(reads.every(([, formId]) => formId === FORM_ID)).toBe(true);
  });

  it('counts every spelling against one no-proof form bucket', async () => {
    const { deps, counted } = platform({ noProof: true });
    const handlers = publicHandlers(deps);
    for (const formId of spellings) {
      await sendAs(handlers, formId, await body({ proof: null }), `key-${formId}`).catch(
        () => null,
      );
    }
    expect(counted('public_form_no_proof_form', FORM_ID)).toBeGreaterThan(0);
    expect(counted('public_form_no_proof_form', upper)).toBe(0);
    expect(counted('public_form_no_proof_form', mixed)).toBe(0);
  });

  it('sends the function the lowercase id and one request hash for every spelling', async () => {
    const { deps, submitted } = platform();
    const handlers = publicHandlers(deps);
    for (const formId of spellings) await sendAs(handlers, formId, await body());
    expect(new Set(submitted.map((one) => one.formId))).toEqual(new Set([FORM_ID]));
    expect(new Set(submitted.map((one) => one.requestHash.toString('hex'))).size).toBe(1);
  });

  it('binds a challenge issued for one spelling to the canonical form', async () => {
    const { deps, submitted } = platform();
    const handlers = publicHandlers(deps);
    const issued = await handlers.getProofChallenge({
      context,
      input: { params: { slug: SLUG, formId: upper } },
      client: CLIENT,
    });
    const proof = await solve(issued.challenge, issued.difficulty);
    await sendAs(handlers, FORM_ID, await body({ proof }));
    expect(submitted).toHaveLength(1);
  });
});
