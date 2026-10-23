// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the submission specs: a funder with one
// programme, one round and a crowd of submissions, which lists them with the
// filters and pages of the real contract, keeps stage moves, and answers
// each submission's page. Answers are plain JSON in the shape of the
// contracts in modules/grants/src/contracts/submissions; the console checks
// each one against its contract, and so does this stand-in for what it takes.

import { stageMoveInputSchema, submissionQuerySchema } from '@pixel-scientists/grants/contracts';
import type { Stage, SubmissionSummary } from '@pixel-scientists/grants/contracts';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';
import { ids, programme, round } from './programme-api.ts';

export { ids };

const PAGE_SIZE = 50;

const NAMES = [
  'Brightwater Community Trust',
  'Harbourside Youth Project',
  'Millbrook Allotment Society',
  'Northfield Lunch Club',
  'Riverside Repair Cafe',
  'Eastgate Music Trust',
];

const stages: Stage[] = [
  { id: ids.intake, name: 'Intake', position: 1, criteria: [] },
  { id: ids.review, name: 'Review', position: 2, criteria: [] },
  { id: ids.decision, name: 'Decision', position: 3, criteria: [] },
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The nth submission: one in seven withdrawn, one in five late, one in six not eligible. */
function submission(n: number): SubmissionSummary {
  return {
    id: uuid(1000 + n),
    programme: { id: ids.programme, title: programme.title },
    round: { id: ids.round, title: round.title },
    stage: { id: ids.intake, name: 'Intake' },
    organisation: {
      id: uuid(2000 + n),
      name: `${NAMES[n % NAMES.length] ?? 'Organisation'} ${String(Math.floor(n / NAMES.length) + 1)}`,
    },
    status: n % 7 === 6 ? 'withdrawn' : 'submitted',
    // The latest first, as the API lists them.
    submittedAt: new Date(Date.UTC(2026, 10, 2, 12) - n * 3_600_000).toISOString(),
    late: n % 5 === 4,
    eligibility: n % 11 === 10 ? null : n % 6 === 5 ? 'stopped' : 'eligible',
  };
}

/** Submissions, the latest submitted first. Spec files may change them between steps. */
export const crowd = (count = 120): SubmissionSummary[] =>
  Array.from({ length: count }, (_, n) => submission(n));

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_org',
      title: 'About your organisation',
      fields: [
        {
          id: 'f_charity',
          type: 'yes_no',
          label: 'Is your organisation a registered charity?',
          required: true,
          eligibility: { stopWhen: false, explanation: 'We only fund registered charities.' },
        },
      ],
    },
    {
      id: 's_project',
      title: 'Your project',
      fields: [
        {
          id: 'f_story',
          type: 'long_text',
          label: 'What will you do with the money?',
          required: true,
        },
      ],
    },
  ],
});

/** One submission in full. */
function detail(summary: SubmissionSummary) {
  const moved = summary.stage.id !== ids.intake;
  return {
    ...summary,
    form: { id: uuid(3000), version: 2, definition },
    answers: { f_charity: summary.eligibility !== 'stopped', f_story: 'We run a weekly lunch.' },
    organisation: {
      ...summary.organisation,
      legalForm: 'Charitable incorporated organisation',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567', verified: true }],
    },
    contact: {
      personId: uuid(4000),
      givenName: 'Sam',
      familyName: 'Patel',
      email: 'sam@example.org',
    },
    withdrawnAt: summary.status === 'withdrawn' ? '2026-11-03T09:00:00.000Z' : null,
    eligibilityChecks:
      summary.eligibility === null
        ? []
        : [
            {
              outcome: summary.eligibility,
              fieldId: summary.eligibility === 'stopped' ? 'f_charity' : null,
              checkedAt: summary.submittedAt,
            },
          ],
    history: [
      { event: 'submitted', at: summary.submittedAt, by: 'Sam Patel' },
      {
        event: 'stage_changed',
        at: summary.submittedAt,
        by: 'Sam Patel',
        from: null,
        to: { id: ids.intake, name: 'Intake' },
      },
      ...(moved
        ? [
            {
              event: 'stage_changed',
              at: '2026-11-04T09:00:00.000Z',
              by: 'Ada Reed',
              from: { id: ids.intake, name: 'Intake' },
              to: summary.stage,
            },
          ]
        : []),
    ],
  };
}

export interface SubmissionStub {
  /** What the funder holds. A spec may change it between steps. */
  held: SubmissionSummary[];
  sent: SentRequest[];
}

const ok = (body: unknown): Reply => ({ status: 200, body });

/** A cursor names the id of the last submission on the page before, as the real one does, but in a form that says nothing else. */
const cursorOf = (id: string) => Buffer.from(id).toString('base64url');
const idOfCursor = (cursor: string) => Buffer.from(cursor, 'base64url').toString();

function list(held: readonly SubmissionSummary[], search: URLSearchParams): Reply {
  const parsed = submissionQuerySchema.safeParse(Object.fromEntries(search));
  if (!parsed.success) return problem(400, 'This filter is not valid.');
  const { programmeId, roundId, stageId, status, eligibility, late, cursor } = parsed.data;
  const matching = held.filter(
    (item) =>
      (programmeId === undefined || item.programme.id === programmeId) &&
      (roundId === undefined || item.round.id === roundId) &&
      (stageId === undefined || item.stage.id === stageId) &&
      (status === undefined || item.status === status) &&
      (eligibility === undefined || item.eligibility === eligibility) &&
      (late === undefined || item.late === late),
  );
  const after =
    cursor === undefined ? -1 : matching.findIndex((item) => item.id === idOfCursor(cursor));
  if (cursor !== undefined && after === -1)
    return problem(400, 'This page is no longer available.');
  const page = matching.slice(after + 1, after + 1 + PAGE_SIZE);
  const last = page.at(-1);
  return ok({
    submissions: page,
    total: matching.length,
    nextCursor: last && after + 1 + PAGE_SIZE < matching.length ? cursorOf(last.id) : null,
  });
}

/**
 * A signed-in programme manager of a funder with `held` submissions. Moving
 * submissions to a stage changes them in `held`, all or none, and a withdrawn
 * submission stops the move, as it does in the API. `more` replaces answers,
 * keyed like `GET /console/programmes`.
 */
export async function stubSubmissions(
  page: Page,
  held: SubmissionSummary[] = crowd(),
  more: Record<string, Handler> = {},
  permissions?: string[],
): Promise<SubmissionStub> {
  const sent = await stubSignedIn(page, permissions ? { permissions } : {}, {
    'GET /console/programmes': ok({
      programmes: [{ ...programme, status: 'open', rounds: [round] }],
    }),
    [`GET /console/rounds/${ids.round}/stages`]: ok({ stages }),
    ...more,
  });

  await page.route(
    (url) =>
      url.pathname.startsWith('/api/console/submissions') ||
      /^\/api\/console\/stages\/[^/]+\/submissions$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/console/, '');
      const reply = ((): Reply => {
        if (request.method() === 'GET' && path === '/submissions') {
          sent.push({ key: `GET /console${path}${url.search}`, body: undefined });
          return list(held, url.searchParams);
        }
        const one = /^\/submissions\/([^/]+)(\/files|\/assignments)?$/.exec(path);
        if (request.method() === 'GET' && one) {
          sent.push({ key: `GET /console${path}`, body: undefined });
          const found = held.find((item) => item.id === one[1]);
          if (found === undefined) return problem(404, 'There is no submission with this address.');
          if (one[2] === '/assignments') return ok({ assignments: [] });
          return ok(one[2] === undefined ? detail(found) : { attachments: [] });
        }
        const move = /^\/stages\/([^/]+)\/submissions$/.exec(path);
        const stage = stages.find((item) => item.id === move?.[1]);
        if (request.method() === 'POST' && stage) {
          const body: unknown = request.postDataJSON();
          sent.push({ key: `POST /console${path}`, body });
          const { submissionIds } = stageMoveInputSchema.parse(body);
          const chosen = submissionIds.map((id) => held.find((item) => item.id === id));
          const problems = chosen.flatMap((item, index) =>
            item?.status === 'withdrawn'
              ? [
                  {
                    field: `body.submissionIds.${String(index)}`,
                    message:
                      'This submission was withdrawn, so it cannot move. Remove it and try again.',
                  },
                ]
              : [],
          );
          if (problems.length > 0) {
            return problem(
              409,
              'No submissions were moved. Remove the ones listed and try again.',
              problems,
            );
          }
          let moved = 0;
          for (const item of chosen) {
            if (item && item.stage.id !== stage.id) {
              item.stage = { id: stage.id, name: stage.name };
              moved += 1;
            }
          }
          return ok({ moved });
        }
        return problem(404, 'No answer was set up for this request.');
      })();
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: JSON.stringify(reply.body),
      });
    },
  );
  return { held, sent };
}
