// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each page reads from the API. Defined once, here, so useLoad reads
// again only when the page asks it to.

import { call } from '@pixel-scientists/domain/api';

import {
  getFramework,
  getFrameworkSummary,
  getResult,
  listFrameworks,
  listLearningNotes,
  listResults,
  listTargets,
} from '../contracts/index.ts';

export const loadFrameworks = () => call(listFrameworks, {});

export const loadFramework = (frameworkId: string) =>
  call(getFramework, { params: { frameworkId } });

export const loadSummary = (frameworkId: string) =>
  call(getFrameworkSummary, { params: { frameworkId }, query: {} });

export const loadResult = (resultId: string) => call(getResult, { params: { resultId } });

/** A page of results, latest period first, for one indicator or all. */
export const loadResults = (frameworkId: string, indicatorId: string, cursor: string | null) =>
  call(listResults, {
    query: {
      frameworkId,
      ...(indicatorId === '' ? {} : { indicatorId }),
      ...(cursor === null ? {} : { cursor }),
    },
  });

/** A framework with its progress, targets and learning notes. Results load on their own. */
export async function loadFrameworkPage(frameworkId: string) {
  const [framework, summary, { targets }, { notes }] = await Promise.all([
    loadFramework(frameworkId),
    loadSummary(frameworkId),
    call(listTargets, { params: { frameworkId } }),
    call(listLearningNotes, { params: { frameworkId } }),
  ]);
  return { framework, summary, targets, notes };
}

export type FrameworkPageData = Awaited<ReturnType<typeof loadFrameworkPage>>;
