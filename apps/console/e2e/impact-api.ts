// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the impact specs: a funder with the Impact tool
// on and a member who sets up outcomes and records results. It keeps what the
// specs change (the framework, its targets, results and notes) and works out
// the progress summary from them. Answers are plain JSON in the shape of the
// contracts in modules/impact/src/contracts.

import type { Page } from '@playwright/test';

import { consoleSession, stubApi } from './auth-api.ts';
import type { Reply, SentRequest } from './auth-api.ts';

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const frameworkId = uuid(1);
const STAMP = '2026-11-01T09:00:00.000Z';

const manager = ['impact.frameworks.read', 'impact.frameworks.manage', 'impact.results.manage'];

interface Body {
  indicatorId: string;
  periodStart: string;
  periodEnd: string;
  [key: string]: unknown;
}

interface Stored {
  id: string;
  name: string;
  description: string;
  outcomes: Record<string, unknown>;
  indicators: Record<string, unknown>;
  version: number;
  archivedAt: null;
  createdAt: string;
  updatedAt: string;
}

export interface ImpactStub {
  sent: SentRequest[];
  /** What the framework holds now, or null before one is made. */
  framework: () => Stored | null;
}

/** A funder with no frameworks yet, which keeps the ones the member makes. */
export async function stubImpact(
  page: Page,
  { permissions = manager }: { permissions?: string[] } = {},
): Promise<ImpactStub> {
  let framework: Stored | null = null;
  const targets: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];

  const summary = () => ({
    frameworkId,
    version: 1,
    indicators: Object.keys(framework?.indicators ?? {}).map((indicatorId) => {
      const mine = results.filter((result) => result.indicatorId === indicatorId);
      const goal = targets.find((target) => target.indicatorId === indicatorId);
      return {
        indicatorId,
        value: mine.length === 0 ? null : mine.reduce((sum, { value }) => sum + Number(value), 0),
        resultCount: mine.length,
        latestPeriodEnd: mine.length === 0 ? null : String(mine[0]?.periodEnd),
        target: goal === undefined ? null : Number(goal.target),
        baseline: null,
      };
    }),
  });

  const sent = await stubApi(page, {
    'GET /auth/session': ok(consoleSession({ permissions, modules: ['grants', 'impact'] })),
    'GET /console/outcome-frameworks': () =>
      ok({
        frameworks:
          framework === null
            ? []
            : [
                {
                  id: frameworkId,
                  name: framework.name,
                  description: framework.description,
                  outcomeCount: Object.keys(framework.outcomes).length,
                  indicatorCount: Object.keys(framework.indicators).length,
                  version: 1,
                  archivedAt: null,
                  updatedAt: STAMP,
                },
              ],
      }),
    'POST /console/outcome-frameworks': (body) => {
      framework = {
        ...(body as Pick<Stored, 'name' | 'description' | 'outcomes' | 'indicators'>),
        id: frameworkId,
        version: 1,
        archivedAt: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      };
      return created(framework);
    },
    [`GET /console/outcome-frameworks/${frameworkId}`]: () => ok(framework),
    [`GET /console/outcome-frameworks/${frameworkId}/summary`]: () => ok(summary()),
    [`GET /console/outcome-frameworks/${frameworkId}/targets`]: () => ok({ targets }),
    [`GET /console/outcome-frameworks/${frameworkId}/learning-notes`]: ok({ notes: [] }),
    'POST /console/indicator-targets': (body) => {
      const target = {
        ...(body as Body),
        id: uuid(10 + targets.length),
        createdAt: STAMP,
        updatedAt: STAMP,
      };
      targets.push(target);
      return created(target);
    },
    [`GET /console/indicator-results?frameworkId=${frameworkId}`]: () =>
      ok({ results, nextCursor: null }),
    'POST /console/indicator-results': (body) => {
      const { note, evidence, ...rest } = body as Body & { note: string; evidence: unknown[] };
      const result = {
        ...rest,
        id: uuid(20 + results.length),
        source: 'manual',
        recordedAt: STAMP,
        updatedAt: STAMP,
        evidenceCount: evidence.length,
      };
      results.unshift(result);
      return created({ ...result, note, evidence });
    },
  });
  return { sent, framework: () => framework };
}
