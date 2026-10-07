// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse feed for Northfield Foundation: 12 tables and 18,402 rows.

import type { DiagramLink, DiagramNode } from './charts/ModelDiagram.tsx';
import { grants } from './grantsData.ts';

export const feedSchedule = 'Every 15 minutes, with only what changed';
export const lastSync = '9:15am, 5 minutes ago';

export interface FeedTable {
  name: string;
  rows: number;
  columns: number;
  /** Where the table sits on the diagram, if it is drawn. */
  place?: { column: number; row: number; shared?: boolean; caption?: string };
  /** What each row belongs to, in words. */
  belongsTo: string;
}

export const feedTables: readonly FeedTable[] = [
  {
    name: 'programme',
    rows: 4,
    columns: 8,
    place: { column: 0, row: 0 },
    belongsTo: 'Nothing: the top of the model',
  },
  { name: 'round', rows: 6, columns: 14, place: { column: 1, row: 0 }, belongsTo: 'programme' },
  { name: 'form_version', rows: 9, columns: 7, belongsTo: 'round' },
  { name: 'criterion', rows: 30, columns: 8, belongsTo: 'round' },
  {
    name: 'organisation',
    rows: 143,
    columns: 16,
    place: { column: 0, row: 1, shared: true, caption: 'Shared with Fairfold CRM' },
    belongsTo: 'Nothing: owned by the party core',
  },
  {
    name: 'person',
    rows: 287,
    columns: 12,
    place: { column: 0, row: 2, shared: true },
    belongsTo: 'organisation',
  },
  {
    name: 'application',
    rows: 204,
    columns: 19,
    place: { column: 2, row: 1 },
    belongsTo: 'round and organisation',
  },
  {
    name: 'answer',
    rows: 15_063,
    columns: 9,
    place: { column: 3, row: 0 },
    belongsTo: 'application',
  },
  {
    name: 'review',
    rows: 411,
    columns: 11,
    place: { column: 3, row: 1 },
    belongsTo: 'application',
  },
  { name: 'score', rows: 2_055, columns: 7, place: { column: 4, row: 1 }, belongsTo: 'review' },
  {
    name: 'decision',
    rows: 137,
    columns: 12,
    place: { column: 3, row: 2 },
    belongsTo: 'application',
  },
  { name: 'grant', rows: 53, columns: 15, place: { column: 4, row: 2 }, belongsTo: 'decision' },
];

export const totalRows = feedTables.reduce((sum, table) => sum + table.rows, 0);
export const totalColumns = feedTables.reduce((sum, table) => sum + table.columns, 0);

export const diagramNodes: readonly DiagramNode[] = feedTables.flatMap((table) =>
  table.place
    ? [
        {
          id: table.name,
          label: table.name,
          detail: `${table.rows.toLocaleString('en-GB')} rows`,
          ...table.place,
        },
      ]
    : [],
);

export const diagramLinks: readonly DiagramLink[] = [
  { from: 'programme', to: 'round' },
  { from: 'round', to: 'application' },
  { from: 'organisation', to: 'application' },
  { from: 'organisation', to: 'person' },
  { from: 'application', to: 'answer' },
  { from: 'application', to: 'review' },
  { from: 'review', to: 'score' },
  { from: 'application', to: 'decision', one: true },
  { from: 'decision', to: 'grant', one: true },
];

/** Two of the four levels in `packages/db/classification.ts`. The feed leaves out nothing less sensitive. */
export interface LeftOutColumn {
  column: string;
  why: string;
  classification: 'Personal' | 'Special category';
}

export const leftOut: readonly LeftOutColumn[] = [
  {
    column: 'person.full_name',
    why: 'Names stay in Fairfold. The feed carries person_id to join on.',
    classification: 'Personal',
  },
  { column: 'person.email', why: 'Contact details stay in Fairfold.', classification: 'Personal' },
  { column: 'person.phone', why: 'Contact details stay in Fairfold.', classification: 'Personal' },
  {
    column: 'organisation.bank_account_number',
    why: 'Bank details stay in Fairfold.',
    classification: 'Personal',
  },
  {
    column: 'organisation.bank_sort_code',
    why: 'Bank details stay in Fairfold.',
    classification: 'Personal',
  },
  {
    column: 'answer.value (personal and equality questions)',
    why: 'Each question’s classification decides. Answers classified personal, such as the main contact’s name, email and phone, stay in Fairfold, and so do equality answers. Equality totals, with counts under 5 hidden, are on Equality monitoring.',
    classification: 'Special category',
  },
  {
    column: 'review.comment',
    why: 'Free text can name people, so it stays in Fairfold.',
    classification: 'Personal',
  },
  {
    column: 'application.internal_notes',
    why: 'Staff notes can name people, so they stay in Fairfold.',
    classification: 'Personal',
  },
];

export const sql = `-- Spring 2027 grants by theme and area
SELECT
  a.theme,
  o.area,
  COUNT(*)      AS grants,
  SUM(g.amount) AS amount
FROM \`northfield-analytics.grants.grant\` AS g
JOIN \`northfield-analytics.grants.decision\` AS d
  USING (decision_id)
JOIN \`northfield-analytics.grants.application\` AS a
  USING (application_id)
JOIN \`northfield-analytics.grants.round\` AS r
  USING (round_id)
JOIN \`northfield-analytics.grants.organisation\` AS o
  USING (organisation_id)
WHERE r.name = 'Spring 2027'
GROUP BY a.theme, o.area
ORDER BY amount DESC
LIMIT 6;`;

export interface QueryRow {
  theme: string;
  area: string;
  grants: number;
  amount: number;
}

const rowsByThemeAndArea = new Map<string, QueryRow>();
for (const grant of grants) {
  const { theme, area } = grant;
  const key = `${theme}, ${area}`;
  const row = rowsByThemeAndArea.get(key) ?? { theme, area, grants: 0, amount: 0 };
  rowsByThemeAndArea.set(key, {
    ...row,
    grants: row.grants + 1,
    amount: row.amount + grant.amount,
  });
}

/** The six largest groups of the 14 grants, from the same list as the areas and themes. */
export const queryResult: readonly QueryRow[] = [...rowsByThemeAndArea.values()]
  .sort((a, b) => b.amount - a.amount)
  .slice(0, 6);
