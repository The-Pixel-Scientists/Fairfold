// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the decision specs: a funder with one round and a
// few submissions, which records decisions privately, keeps them until they
// are released, and asks for step-up before releasing or sending emails, as
// the real routes do. Answers are plain JSON in the shape of the contracts in
// modules/grants/src/contracts/decisions; the console checks each one against
// its contract, and so does this stand-in for what it takes.

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  bulkDecisionInputSchema,
  decisionInputSchema,
  decisionListSchema,
  defaultEmailTemplates,
  releaseInputSchema,
  renderTemplate,
} from '@pixel-scientists/grants/contracts';
import type { DecisionInput, Outcome } from '@pixel-scientists/grants/contracts';
import type { Page } from '@playwright/test';

import { consoleSession, problem } from './auth-api.ts';
import type { Reply } from './auth-api.ts';
import { ids, programme, round } from './programme-api.ts';
import { crowd, stubSubmissions } from './submissions-api.ts';
import type { SubmissionStub } from './submissions-api.ts';

export { ids };

const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const gbp = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' as const });

interface Held {
  outcome: Outcome;
  amountMinor: number | null;
  recordedAt: string;
  releasedAt: string | null;
  email: 'pending' | 'sent' | null;
}

export interface DecisionStub extends SubmissionStub {
  /** The decisions recorded, by submission. A spec may change them between steps. */
  decisions: Map<string, Held>;
  /** True once the person has confirmed it is them. */
  recent: boolean;
}

export interface DecisionOptions {
  /** How many submissions the round has. */
  count?: number;
  /** The round's budget, in pounds. */
  budget?: number;
  /** How many emails a release leaves waiting to send. */
  holdBack?: number;
  permissions?: string[];
}

const ok = (body: unknown): Reply => ({ status: 200, body });

/** Records a decision on the nth submission as a spec's set-up, released or not, with its email waiting or sent. */
export function decide(
  stub: DecisionStub,
  index: number,
  outcome: Outcome,
  change: { pounds?: number; released?: boolean; email?: 'pending' | 'sent' } = {},
): void {
  const found = stub.held[index];
  if (found === undefined) throw new Error(`There is no submission ${String(index)}.`);
  stub.decisions.set(found.id, {
    outcome,
    amountMinor: outcome === 'accepted' ? (change.pounds ?? 12_500) * 100 : null,
    recordedAt: '2026-11-20T10:00:00.000Z',
    releasedAt: change.released ? '2026-11-26T09:00:00.000Z' : null,
    email: change.released ? (change.email ?? 'sent') : null,
  });
}

/** A submission's mean score, highest first, as the API ranks them. */
const meanOf = (index: number) => Math.round((4.4 - index * 0.2) * 100) / 100;

/**
 * A signed-in programme manager of a funder with a round that has `count`
 * submitted submissions. Recording keeps decisions private until a release,
 * which needs a recent sign-in: the stand-in's step-up route accepts any
 * password but "wrong password".
 */
export async function stubDecisions(
  page: Page,
  options: DecisionOptions = {},
): Promise<DecisionStub> {
  const { count = 6, budget = 150_000, holdBack = 0, permissions } = options;
  const submissions = crowd(count);
  const stub: DecisionStub = {
    held: submissions,
    sent: [],
    decisions: new Map(),
    recent: false,
  };
  const range = {
    id: ids.round,
    title: round.title,
    budget: gbp(budget),
    awardMinimum: round.awardMinimum,
    awardMaximum: round.awardMaximum,
  };

  const rangeProblem = (amountMinor: number) =>
    amountMinor < range.awardMinimum.amountMinor || amountMinor > range.awardMaximum.amountMinor
      ? `Enter an amount between ${formatMoney(range.awardMinimum)} and ${formatMoney(range.awardMaximum)}.`
      : undefined;

  const write = (submissionId: string, input: DecisionInput) => {
    stub.decisions.set(submissionId, {
      outcome: input.outcome,
      amountMinor: input.outcome === 'accepted' ? input.amount.amountMinor : null,
      recordedAt: '2026-11-20T10:00:00.000Z',
      releasedAt: null,
      email: null,
    });
  };

  const decisionOf = (held: Held) => ({
    outcome: held.outcome,
    amount: held.amountMinor === null ? null : { amountMinor: held.amountMinor, currency: 'GBP' },
    recordedAt: held.recordedAt,
    releasedAt: held.releasedAt,
  });

  const unsent = () =>
    [...stub.decisions.values()].filter((item) => item.releasedAt !== null && item.email !== 'sent')
      .length;

  const listing = () =>
    decisionListSchema.parse({
      round: range,
      submissions: submissions.map((item, index) => {
        const held = stub.decisions.get(item.id);
        return {
          submissionId: item.id,
          organisation: item.organisation,
          stage: item.stage,
          meanScore: meanOf(index),
          reviews: 2,
          decision: held ? decisionOf(held) : null,
          email: held?.email ?? null,
        };
      }),
      awarded: {
        amountMinor: [...stub.decisions.values()].reduce(
          (sum, item) => sum + (item.amountMinor ?? 0),
          0,
        ),
        currency: 'GBP',
      },
      unsentEmails: unsent(),
    });

  const preview = (submissionId: string): Reply => {
    const held = stub.decisions.get(submissionId);
    const found = submissions.find((item) => item.id === submissionId);
    if (held === undefined || found === undefined)
      return problem(404, 'There is no decision here.');
    const email = renderTemplate(
      { outcome: held.outcome, ...defaultEmailTemplates[held.outcome] },
      {
        givenName: 'Sam',
        organisationName: found.organisation.name,
        programmeTitle: programme.title,
        roundTitle: round.title,
        portalLink: 'https://grants.example.org/portal',
        amount:
          held.amountMinor === null ? null : { amountMinor: held.amountMinor, currency: 'GBP' },
      },
    );
    return ok(email);
  };

  const needsStepUp = (): Reply | null => (stub.recent ? null : problem(403, STEP_UP_NEEDED));

  stub.sent = (
    await stubSubmissions(
      page,
      submissions,
      {
        [`GET /console/rounds/${ids.round}`]: ok(round),
        [`GET /console/programmes/${ids.programme}`]: ok(programme),
        'POST /auth/step-up': (body) => {
          if ((body as { password?: string }).password === 'wrong password') {
            return problem(401, 'The email address or password is not right.');
          }
          stub.recent = true;
          return ok({
            ...consoleSession(permissions ? { permissions } : {}),
            recentAuthUntil: '2099-01-01T00:00:00.000Z',
          });
        },
      },
      permissions,
    )
  ).sent;

  await page.route(
    (url) =>
      /^\/api\/console\/rounds\/[^/]+\/decision/.test(url.pathname) ||
      /^\/api\/console\/submissions\/[^/]+\/decision/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api\/console/, '');
      const method = request.method();
      const body: unknown = request.postData() === null ? undefined : request.postDataJSON();
      const reply = ((): Reply => {
        const one = /^\/submissions\/([^/]+)\/decision(\/email)?$/.exec(path);
        if (one && method === 'GET' && one[2]) return preview(one[1] ?? '');
        if (one && method === 'PUT') {
          const id = one[1] ?? '';
          const input = decisionInputSchema.parse(body);
          const wrong =
            input.outcome === 'accepted' ? rangeProblem(input.amount.amountMinor) : undefined;
          if (wrong) return problem(400, wrong, [{ field: 'body.amount', message: wrong }]);
          if (stub.decisions.get(id)?.releasedAt) {
            return problem(409, 'This decision has been released, so it can no longer change.');
          }
          write(id, input);
          return ok(decisionOf(stub.decisions.get(id) as Held));
        }
        if (path === `/rounds/${ids.round}/decisions` && method === 'GET') return ok(listing());
        if (path === `/rounds/${ids.round}/decisions` && method === 'POST') {
          const { decisions } = bulkDecisionInputSchema.parse(body);
          const wrong = decisions.flatMap(({ decision }, index) => {
            const message =
              decision.outcome === 'accepted'
                ? rangeProblem(decision.amount.amountMinor)
                : undefined;
            return message
              ? [{ field: `body.decisions.${String(index)}.decision.amount`, message }]
              : [];
          });
          if (wrong.length > 0) {
            return problem(400, 'Fix the fields listed and try again.', wrong);
          }
          for (const { submissionId, decision } of decisions) write(submissionId, decision);
          return ok({ recorded: decisions.length });
        }
        if (path === `/rounds/${ids.round}/decisions/release` && method === 'POST') {
          const refused = needsStepUp();
          if (refused) return refused;
          const input = releaseInputSchema.parse(body);
          const waiting = [...stub.decisions]
            .filter(
              ([id, item]) =>
                item.releasedAt === null &&
                (input.release === 'all' || input.submissionIds.includes(id)),
            )
            .map(([, item]) => item);
          const sent = Math.max(waiting.length - holdBack, 0);
          waiting.forEach((item, index) => {
            item.releasedAt = '2026-11-26T09:00:00.000Z';
            item.email = index < sent ? 'sent' : 'pending';
          });
          return ok({ released: waiting.length, sent, failed: 0, pending: waiting.length - sent });
        }
        if (path === `/rounds/${ids.round}/decision-emails/send` && method === 'POST') {
          const refused = needsStepUp();
          if (refused) return refused;
          let sent = 0;
          for (const item of stub.decisions.values()) {
            if (item.releasedAt !== null && item.email !== 'sent') {
              item.email = 'sent';
              sent += 1;
            }
          }
          return ok({ sent, failed: 0, pending: 0 });
        }
        return problem(404, 'No answer was set up for this request.');
      })();
      stub.sent.push({ key: `${method} /console${path}`, body });
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: reply.body === undefined ? undefined : JSON.stringify(reply.body),
      });
    },
  );
  return stub;
}
