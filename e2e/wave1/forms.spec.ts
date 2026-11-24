// SPDX-License-Identifier: AGPL-3.0-or-later
//
// forms in the all-tools funder: a forms member makes a small form with a
// required question, publishes it, and reads the responses; a signed-in
// applicant answers it once, even when the request is sent twice with one
// Idempotency-Key; and a visitor with no session answers it through the public
// route, solving the browser check for real, with no cookie set.
//
// The anonymous routes are registered only with the forms hash key, and call two
// database functions (forms.public_form and forms.submit_public_response) that
// no migration creates yet. Until both exist the anonymous tests skip, saying so,
// and run on their own after. The embed origin is not covered here: it needs the
// host's origin list, which the stack does not set.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Api } from '../support/api.ts';
import { axePages } from '../support/axe.ts';
import { consoleOrigin } from '../support/env.ts';
import {
  asSlug,
  auditReader,
  jsonOf,
  call,
  eventsAbout,
  expect,
  keyed,
  onWave1,
  signInApplicant,
  signInAs,
  staffName,
  test,
} from './support.ts';

onWave1();

const slug = 'linnetford';
const QUESTION = 'f_visit';
const TITLE = 'Tell us about your visit';

const definition = {
  sections: [
    {
      id: 's_visit',
      title: 'Your visit',
      fields: [
        {
          id: QUESTION,
          type: 'short_text',
          label: 'What did you come for?',
          required: true,
          maxCharacters: 120,
        },
      ],
    },
  ],
};

interface Version {
  id: string;
  version: number;
}

interface PublicForm {
  formVersionId: string;
}

interface Challenge {
  challenge: string;
  difficulty: number;
}

let manager: Api;
let reviewer: Api;
let applicant: Api;
let reader: Api;
let visitor: Api | undefined;
let formId = '';
let version: Version;
let missing: string | undefined;

const NOT_PUBLIC =
  'The anonymous form routes are not answering on the stack: they need the forms hash key in the stack settings (lead) and the database functions forms.public_form and forms.submit_public_response (db-security). Owner: lead and db-security.';
const skipUnlessPublic = () => {
  test.skip(missing !== undefined, missing ?? '');
};

/** The browser check, solved as the page does: 16 nonces whose SHA-256 of `challenge:index:nonce` starts with `difficulty` zero bits. */
function solve({ challenge, difficulty }: Challenge): { challenge: string; nonces: number[] } {
  const zeroBits = (digest: Buffer) => {
    let bits = 0;
    for (const byte of digest) {
      if (byte !== 0) return bits + Math.clz32(byte) - 24;
      bits += 8;
    }
    return bits;
  };
  const nonces = Array.from({ length: 16 }, (_, index) => {
    for (let nonce = 0; ; nonce += 1) {
      const digest = createHash('sha256')
        .update(`${challenge}:${String(index)}:${String(nonce)}`)
        .digest();
      if (zeroBits(digest) >= difficulty) return nonce;
    }
  });
  return { challenge, nonces };
}

const publicPath = (suffix = '') => `/public/tenants/${slug}/forms/${formId}${suffix}`;

async function send(answers: Record<string, unknown>, key: string, token: string) {
  const form = await jsonOf<PublicForm>(call(anonymous(), 'GET', publicPath()));
  const challenge = await jsonOf<Challenge>(call(anonymous(), 'GET', publicPath('/challenge')));
  return keyed(
    anonymous(),
    'POST',
    publicPath('/responses'),
    {
      formVersionId: form.formVersionId,
      respondentToken: token,
      proof: solve(challenge),
      answers,
    },
    key,
  );
}

function anonymous(): Api {
  if (visitor === undefined) throw new Error('The visitor has no session yet.');
  return visitor;
}

test.describe('forms: publish, answer signed in, answer without signing in', () => {
  test.beforeAll(async () => {
    manager = await signInAs(slug, 'programme_manager');
    reviewer = await signInAs(slug, 'reviewer');
    applicant = await signInApplicant(slug);
    reader = await auditReader(slug);
    visitor = await Api.open(consoleOrigin);
  });

  test.afterAll(async () => {
    await Promise.all(
      [manager, reviewer, applicant, reader, ...(visitor ? [visitor] : [])].map((session) =>
        session.dispose(),
      ),
    );
  });

  test('a reviewer and an applicant are denied the form builder', async () => {
    expect((await call(reviewer, 'GET', '/console/forms')).status).toBe(403);
    expect((await call(applicant, 'GET', '/console/forms')).status).toBe(403);
    expect((await call(reviewer, 'POST', '/console/forms', {})).status).toBe(403);
  });

  test('a member makes a form, saves a draft with a required question, and publishes it once', async () => {
    const made = await jsonOf<{ id: string; status: string }>(
      keyed(manager, 'POST', '/console/forms', {
        title: TITLE,
        description: 'A few questions about your visit.',
        respondents: 'both',
        opensAt: null,
        closesAt: null,
        confirmationMessage: 'Thank you, we have your answer.',
      }),
      201,
    );
    formId = made.id;
    expect(made.status).toBe('draft');

    await jsonOf(call(manager, 'PUT', `/console/forms/${formId}/draft`, { definition }));
    const key = randomUUID();
    version = await jsonOf<Version>(
      keyed(manager, 'POST', `/console/forms/${formId}/versions`, undefined, key),
      201,
    );
    const again = await keyed(manager, 'POST', `/console/forms/${formId}/versions`, undefined, key);
    expect((again.json as Version).id).toBe(version.id);

    const { versions } = await jsonOf<{ versions: Version[] }>(
      call(manager, 'GET', `/console/forms/${formId}/versions`),
    );
    expect(versions).toHaveLength(1);
    for (const action of ['forms.form.created', 'forms.form_draft.saved']) {
      expect(await eventsAbout(reader, slug, action, formId), action).toHaveLength(1);
    }
    expect(
      await eventsAbout(reader, slug, 'forms.form_version.published', version.id),
    ).toHaveLength(1);
  });

  test('@a11y the forms list and the responses page open for the member', async ({ pages }) => {
    const page = await pages.staff(staffName(slug, 'programme_manager'), asSlug(slug));
    await axePages(page, [`/${slug}/forms`, `/${slug}/forms/${formId}/responses`]);
  });

  test('a signed-in applicant answers once, a second send with the same key adds nothing, and the member reads it', async () => {
    const path = `/portal/forms/${formId}/responses`;
    const portal = await jsonOf<{ formVersionId: string }>(
      call(applicant, 'GET', `/portal/forms/${formId}`),
    );
    expect(portal.formVersionId).toBe(version.id);

    const refused = await keyed(applicant, 'POST', path, {
      formVersionId: version.id,
      answers: {},
    });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain(QUESTION);

    const key = randomUUID();
    const answers = { [QUESTION]: 'Collecting a food parcel' };
    const first = await jsonOf<{ responseId: string }>(
      keyed(applicant, 'POST', path, { formVersionId: version.id, answers }, key),
      201,
    );
    const again = await keyed(applicant, 'POST', path, { formVersionId: version.id, answers }, key);
    expect((again.json as { responseId: string }).responseId).toBe(first.responseId);

    const totals = await jsonOf<{ received: number; signedIn: number; anonymous: number }>(
      call(manager, 'GET', `/console/forms/${formId}/response-totals`),
    );
    expect(totals).toMatchObject({ received: 1, signedIn: 1, anonymous: 0 });

    const read = await jsonOf<{ id: string; answers: Record<string, unknown> }>(
      call(manager, 'GET', `/console/form-responses/${first.responseId}`),
    );
    expect(JSON.stringify(read.answers)).toContain('Collecting a food parcel');
    expect(
      await eventsAbout(reader, slug, 'forms.response.submitted', first.responseId),
    ).toHaveLength(1);
    expect(await eventsAbout(reader, slug, 'forms.response.viewed', first.responseId)).toHaveLength(
      1,
    );
    expect(
      (await call(reviewer, 'GET', `/console/form-responses/${first.responseId}`)).status,
    ).toBe(403);
  });

  test('a visitor with no session can open the form, and the page sets no cookie', async ({
    pages,
  }) => {
    const probe = await call(anonymous(), 'GET', publicPath());
    if (probe.status !== 200) missing = NOT_PUBLIC;
    skipUnlessPublic();

    const page = await pages.visitor('portal');
    await axePages(page, [`/${slug}/forms/${formId}`]);
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText('Your answers stay on this device')).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    await axePages(page, [`/${slug}/forms/${formId}`]);
  });

  test('a missing required answer gets a plain error by field id; one send is one response, even sent twice', async () => {
    skipUnlessPublic();
    const token = randomBytes(32).toString('base64url');
    const missingAnswer = await send({}, randomUUID(), token);
    expect(missingAnswer.status).toBe(400);
    expect(missingAnswer.text).toContain(QUESTION);

    const key = randomUUID();
    const answers = { [QUESTION]: 'Returning a library book' };
    const first = await send(answers, key, token);
    const receipt = await jsonOf<{ responseId: string }>(first, 201);
    expect(first.headers['set-cookie']).toBeUndefined();
    const again = await send(answers, key, token);
    expect((again.json as { responseId: string }).responseId).toBe(receipt.responseId);

    const totals = await jsonOf<{ anonymous: number }>(
      call(manager, 'GET', `/console/forms/${formId}/response-totals`),
    );
    expect(totals.anonymous).toBe(1);
    const found = await call(manager, 'POST', '/console/form-responses/lookup', {
      reference: token,
    });
    expect((await jsonOf<{ id: string }>(found)).id).toBe(receipt.responseId);
  });

  test('a fast run of requests is limited with Retry-After, and the limit is never counted as a pass', async () => {
    skipUnlessPublic();
    let limited: { status: number; headers: Record<string, string> } | undefined;
    for (let attempt = 0; attempt < 200 && limited === undefined; attempt += 1) {
      const answer = await anonymous().send('GET', publicPath('/challenge'));
      if (answer.status === 429) limited = answer;
      else expect(answer.status, 'a public read').toBe(200);
    }
    expect(limited, 'no 429 within 200 reads').toBeDefined();
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
  });
});
