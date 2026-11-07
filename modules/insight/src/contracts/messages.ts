// SPDX-License-Identifier: AGPL-3.0-or-later
//
// insight's messages, in the words of docs/CONTENT-STYLE.md: what is wrong
// and how to fix it. None repeats a submitted value or names a table, cell
// or number. Validation messages are attached with says(), which marks them
// as written from a catalogue, so messageForIssue() shows them on both
// sides. Refusals are the detail of a problem the server answers.

import { catalogueParams } from '@pixel-scientists/domain/platform';

export const insightMessages = {
  reportName: 'Enter a name for the report.',
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  columns: 'Choose columns from the table the report reads.',
  measures: 'Choose from 1 to 10 things to count or add up.',
  groupBy: 'Choose up to 3 columns to group by.',
  filters: 'Choose up to 10 filters.',
  oneBreakdown: 'Choose one breakdown at most.',
  oneFilter: 'Choose one filter at most.',
  minimumGroup: 'Enter a minimum group the same as or more than the threshold.',
  periodOrder: 'Enter an end date after the start date.',
} as const;

export type InsightMessage = (typeof insightMessages)[keyof typeof insightMessages];

/** A refinement's options, for a message from the list above. */
export function says(message: InsightMessage) {
  return { error: message, params: catalogueParams };
}

/** What an equality monitoring report shows in place of a table with too few responses. */
export const withheldMessage = 'Too few responses to show this report. Choose a wider filter.';

/** The detail of each problem insight's routes answer, all 409. */
export const insightRefusals = {
  /** The run log found that this table, set against earlier runs, would reveal a small group (ADR 0032). */
  monitoringRefused:
    "This report can't be shown now, because it could be set against earlier reports to reveal a small group. Choose a wider filter.",
  archived: 'This report is archived. Make a new report to change or run it.',
  kindFixed: "A report's kind can't be changed. Make a new report instead.",
  monitoringOnly: 'Run equality monitoring reports from the equality monitoring page.',
  notMonitoring: 'This is not an equality monitoring report. Run it from the reports page.',
  notPrepared: 'Only a prepared publication can be marked as submitted. Wait until it is prepared.',
} as const;
