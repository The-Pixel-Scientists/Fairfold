// SPDX-License-Identifier: AGPL-3.0-or-later
//
// After the demo: the edges a round meets. File limits (size, type, a type the
// name lies about, too many files, a name with a path in it), two sittings
// saving over each other, an application withdrawn and then touched, an
// ineligible answer and an over-long answer at submission, a closing time seen
// from another time zone and across the clocks changing, and a submission that
// arrives after the deadline under each late policy.

import { formDefinitionInputSchema } from '../../modules/grants/src/contracts/index.ts';
import { fileRefusalMessages } from '../../packages/domain/src/files/index.ts';
import { accountsPdf, budgetSpreadsheet, pdfOfSize } from '../fixtures/files.ts';
import { signInApplicant, signInStaff, type Api } from '../support/api.ts';
import {
  answersFor,
  applicantWithOrganisation,
  groups,
  type Applicant,
} from '../support/applications.ts';
import { londonLocal } from '../support/clock.ts';
import { portalOrigin, stateFile } from '../support/env.ts';
import { need } from '../support/state.ts';
import { expect, inOrder, test } from '../support/test.ts';

inOrder();

const MB = 1024 * 1024;

interface Started {
  id: string;
  answersVersion: number;
  form: { definition: { sections: { fields: Field[] }[] } };
}

interface Field {
  id: string;
  type: string;
  label: string;
  columns?: { id: string; type: string; label: string; options?: { value: string }[] }[];
}

/** A group of the demo's kind, under another name, with its own charity number. */
function edgeGroup(name: string, number: string): Applicant {
  const [template] = groups;
  if (template === undefined) throw new Error('The demo has no groups.');
  return {
    ...template,
    name,
    givenName: 'Edge',
    familyName: name,
    organisation: `${name} Group`,
    charityNumber: number,
  };
}

const start = (api: Api, roundId: string, organisationId: string): Promise<Started> =>
  api.ok<Started>('POST', `/portal/rounds/${roundId}/applications`, { json: { organisationId } });

const fieldsOf = (started: Started): Field[] =>
  started.form.definition.sections.flatMap((section) => section.fields);

/** The one applicant of these tests, who starts an application in the demo's round, and the session they use. */
let edge: { api: Api; organisationId: string; applicationId: string; form: Started } | undefined;

function shared(): NonNullable<typeof edge> {
  if (edge === undefined) throw new Error('The first edge test makes the applicant.');
  return edge;
}

const uploadPath = (applicationId: string): string =>
  `/portal/applications/${applicationId}/fields/${need('accountsFieldId')}/files`;

test.describe('after the demo: the edges of a round', () => {
  test('refuses files that break the question’s limits, and keeps only the two that fit', async () => {
    // One account makes every application here: a sign-up email counts against the hourly limit.
    const { api, organisationId } = await applicantWithOrganisation(edgeGroup('edge1', '1209001'));
    const started = await start(api, need('roundId'), organisationId);
    edge = { api, organisationId, applicationId: started.id, form: started };
    const upload = (name: string, bytes: Buffer) =>
      api.send('POST', uploadPath(started.id), { file: { name, bytes } });
    const refused = async (name: string, bytes: Buffer, detail: string) => {
      const answer = await upload(name, bytes);
      expect(answer.status, name).toBe(400);
      expect((answer.json as { detail?: string }).detail, name).toBe(detail);
    };

    // The accounts question takes a PDF or Word document, up to 5 MB, and two files.
    await refused('big.pdf', pdfOfSize(5 * MB + 1), fileRefusalMessages.too_large);
    await refused('sheet.xlsx', budgetSpreadsheet(), fileRefusalMessages.type_not_allowed);
    await refused(
      'notes.pdf',
      Buffer.from('plain text, not a PDF'),
      fileRefusalMessages.type_not_allowed,
    );
    await refused('accounts.docx', accountsPdf(), fileRefusalMessages.wrong_extension);
    expect((await upload('folder/accounts.pdf', accountsPdf())).status).toBe(400);
    expect(
      (await upload(`accounts${String.fromCodePoint(0x202e)}fdp.pdf`, accountsPdf())).status,
    ).toBe(400);
    expect((await upload('accounts-one.pdf', accountsPdf())).status).toBe(201);
    expect((await upload('accounts-two.pdf', accountsPdf())).status).toBe(201);
    await refused('accounts-three.pdf', accountsPdf(), fileRefusalMessages.too_many);

    const { attachments } = await api.ok<{ attachments: { name: string }[] }>(
      'GET',
      `/portal/applications/${started.id}/files`,
    );
    expect(attachments.map(({ name }) => name).sort()).toEqual([
      'accounts-one.pdf',
      'accounts-two.pdf',
    ]);
  });

  // The API answers 413 and closes the connection early, so the web server in front of it
  // sometimes answers 502, "The API did not answer", before the 413 arrives.
  test('refuses an upload over the API’s body limit, and keeps nothing', async () => {
    const own = await signInApplicant('northfield', 'edge1');
    const answer = await own.send('POST', uploadPath(shared().applicationId), {
      file: { name: 'huge.pdf', bytes: pdfOfSize(11 * MB) },
    });
    expect([413, 502]).toContain(answer.status);
    await own.dispose();

    const { attachments } = await shared().api.ok<{ attachments: { name: string }[] }>(
      'GET',
      `/portal/applications/${shared().applicationId}/files`,
    );
    expect(attachments).toHaveLength(2);
  });

  test('two sittings saving over each other: the second save is refused until it has read the first', async () => {
    const { api, applicationId, form } = shared();
    expect(fieldsOf(form).some(({ id }) => id === need('projectFieldId'))).toBe(true);
    const save = (basedOn: number, text: string) =>
      api.send('PUT', `/portal/applications/${applicationId}/answers`, {
        json: { basedOn, answers: { [need('projectFieldId')]: text } },
      });

    expect((await save(form.answersVersion, 'First sitting.')).status).toBe(200);
    expect(
      (await save(form.answersVersion, 'Second sitting, which never read the first.')).status,
    ).toBe(409);
    const current = await api.ok<{ answersVersion: number; answers: Record<string, unknown> }>(
      'GET',
      `/portal/applications/${applicationId}`,
    );
    expect(current.answers[need('projectFieldId')]).toBe('First sitting.');
    expect((await save(current.answersVersion, 'Both sittings, together.')).status).toBe(200);
  });

  test('a withdrawn application takes no more answers, no submission and no decision', async () => {
    const applicant = await signInApplicant('northfield', 'applicant7');
    const id = need('withdrawnApplicationId');
    const current = await applicant.ok<{ status: string; answersVersion: number }>(
      'GET',
      `/portal/applications/${id}`,
    );
    expect(current.status).toBe('withdrawn');
    const refused = [
      await applicant.send('PUT', `/portal/applications/${id}/answers`, {
        json: { basedOn: current.answersVersion, answers: {} },
      }),
      await applicant.send('POST', `/portal/applications/${id}/submit`, {
        json: { basedOn: current.answersVersion },
      }),
      await applicant.send('POST', `/portal/applications/${id}/withdraw`),
    ];
    for (const answer of refused) {
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.status).toBeLessThan(500);
    }
    await applicant.dispose();

    const manager = await signInStaff('northfield', 'manager');
    const decided = await manager.send('PUT', `/console/submissions/${id}/decision`, {
      json: { outcome: 'declined' },
    });
    expect(decided.status).toBeGreaterThanOrEqual(400);
    expect(decided.status).toBeLessThan(500);
    await manager.dispose();
  });

  test('an ineligible answer, or one over the word limit, is refused at submission and nothing is sent', async () => {
    const { api, applicationId, form } = shared();
    const group = edgeGroup('edge1', '1209001');
    for (const [reason, change] of [
      ['ineligible', { [need('charityFieldId')]: false }],
      [
        'over the word limit',
        { [need('projectFieldId')]: Array.from({ length: 301 }, () => 'word').join(' ') },
      ],
    ] as const) {
      const before = await api.ok<{ answersVersion: number }>(
        'GET',
        `/portal/applications/${applicationId}`,
      );
      const answers = { ...answersFor(fieldsOf(form), group), ...change };
      await api.send('PUT', `/portal/applications/${applicationId}/answers`, {
        json: { basedOn: before.answersVersion, answers },
      });
      const now = await api.ok<{ answersVersion: number }>(
        'GET',
        `/portal/applications/${applicationId}`,
      );
      const submitted = await api.send('POST', `/portal/applications/${applicationId}/submit`, {
        json: { basedOn: now.answersVersion },
      });
      expect(submitted.status, reason).toBeGreaterThanOrEqual(400);
      expect(submitted.status, reason).toBeLessThan(500);
      const after = await api.ok<{ status: string }>(
        'GET',
        `/portal/applications/${applicationId}`,
      );
      expect(after.status, reason).toBe('in_progress');
    }
  });

  test('the closing time is the funder’s wall clock for a browser in another time zone, and across the clocks changing', async ({
    browser,
  }) => {
    // Applicant one is signed in; the browser thinks it is in Auckland.
    const context = await browser.newContext({
      baseURL: portalOrigin,
      timezoneId: 'Pacific/Auckland',
      storageState: `${stateFile}.applicant1.session.json`,
    });
    const page = await context.newPage();
    await page.goto(`/northfield/programmes/${need('roundId')}`);
    await expect(page.getByText(need('closingUkTime')).first()).toBeVisible();
    await context.close();

    // A round over the night the clocks go back (25 October 2026) keeps the times it was given.
    const manager = await signInStaff('northfield', 'manager');
    const money = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' });
    const created = await manager.ok<{
      id: string;
      opensAt: string;
      closesAt: string;
      timeZone: string;
    }>('POST', `/console/programmes/${need('programmeId')}/rounds`, {
      json: {
        title: 'Clocks go back',
        opensAt: '2026-10-24T09:00',
        closesAt: '2026-10-26T09:00',
        budget: money(10_000),
        awardMinimum: money(100),
        awardMaximum: money(1000),
        latePolicy: 'refuse',
      },
    });
    expect(created).toMatchObject({
      opensAt: '2026-10-24T09:00',
      closesAt: '2026-10-26T09:00',
      timeZone: 'Europe/London',
    });
    await manager.dispose();
  });

  test('a submission after the deadline is refused or flagged late, by the round’s policy', async () => {
    // The rounds close between two and three minutes from now, and the test waits for that.
    test.setTimeout(420_000);
    const manager = await signInStaff('northfield', 'manager');
    const money = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' });
    const programme = await manager.ok<{ id: string }>('POST', '/console/programmes', {
      json: {
        title: 'Late rules',
        summary: 'Two rounds that close in a moment.',
        description: '',
        status: 'open',
      },
    });
    const definition = formDefinitionInputSchema.parse({
      sections: [
        {
          id: 's_note',
          title: 'A note',
          fields: [{ id: 'f_note', type: 'short_text', label: 'A note', required: false }],
        },
      ],
    });
    const rounds: Record<'refuse' | 'accept_and_flag', string> = {
      refuse: '',
      accept_and_flag: '',
    };
    for (const policy of ['refuse', 'accept_and_flag'] as const) {
      const round = await manager.ok<{ id: string }>(
        'POST',
        `/console/programmes/${programme.id}/rounds`,
        {
          json: {
            title: `Closes soon, ${policy}`,
            opensAt: londonLocal(-24 * 60),
            closesAt: londonLocal(3),
            budget: money(10_000),
            awardMinimum: money(100),
            awardMaximum: money(1000),
            latePolicy: policy,
          },
        },
      );
      const draft = await manager.ok<{ id: string }>(
        'POST',
        `/console/rounds/${round.id}/form-versions`,
      );
      await manager.ok('PUT', `/console/form-versions/${draft.id}/definition`, {
        json: { definition },
      });
      await manager.ok('POST', `/console/form-versions/${draft.id}/publish`);
      rounds[policy] = round.id;
    }

    // An applicant starts both while they are open, and fills them in.
    const { api, organisationId } = shared();
    const applications: Record<string, string> = {};
    for (const policy of ['refuse', 'accept_and_flag'] as const) {
      const started = await start(api, rounds[policy], organisationId);
      await api.ok('PUT', `/portal/applications/${started.id}/answers`, {
        json: { basedOn: started.answersVersion, answers: { f_note: 'Nearly in time.' } },
      });
      applications[policy] = started.id;
    }

    // Once both have closed, the portal no longer lists them as open.
    await expect
      .poll(
        async () => {
          const { rounds: open } = await api.ok<{ rounds: { id: string }[] }>(
            'GET',
            '/portal/rounds',
          );
          return open.filter(({ id }) => Object.values(rounds).includes(id)).length;
        },
        { message: 'The two short rounds have not closed.', timeout: 240_000, intervals: [2000] },
      )
      .toBe(0);

    const send = async (policy: 'refuse' | 'accept_and_flag') => {
      const current = await api.ok<{ answersVersion: number }>(
        'GET',
        `/portal/applications/${applications[policy] ?? ''}`,
      );
      return api.send('POST', `/portal/applications/${applications[policy] ?? ''}/submit`, {
        json: { basedOn: current.answersVersion },
      });
    };
    const refused = await send('refuse');
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect(
      (
        await api.ok<{ status: string }>(
          'GET',
          `/portal/applications/${applications['refuse'] ?? ''}`,
        )
      ).status,
    ).toBe('in_progress');

    expect((await send('accept_and_flag')).status).toBe(200);
    const late = await manager.ok<{ submissions: { id: string; late: boolean }[] }>(
      'GET',
      '/console/submissions',
      { query: { roundId: rounds.accept_and_flag, late: 'true' } },
    );
    expect(late.submissions.map(({ id }) => id)).toEqual([applications['accept_and_flag']]);
    const onTime = await manager.ok<{ submissions: unknown[] }>('GET', '/console/submissions', {
      query: { roundId: rounds.refuse },
    });
    expect(onTime.submissions).toEqual([]);

    await manager.dispose();
  });

  test.afterAll(async () => {
    await edge?.api.dispose();
  });
});
