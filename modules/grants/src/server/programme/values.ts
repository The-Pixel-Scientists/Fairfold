// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The values a programme or round records in its configuration versions
// (contracts/programme/config.ts), and the audit changes that follow from
// the diff. Local times are recorded as entered, with the zone beside them.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  outcomeIds,
  type ConfigDiff,
  type ConfigObject,
  type Outcome,
  type Programme,
  type Round,
  type Stage,
} from '../../contracts/index.ts';

export const programmeValues = ({
  title,
  summary,
  description,
  status,
}: Omit<Programme, 'id'>): ConfigObject => ({ title, summary, description, status });

export const templateValues = (
  templates: Record<Outcome, { subject: string; body: string }>,
): ConfigObject => ({
  emailTemplates: Object.fromEntries(
    outcomeIds.map((outcome) => [
      outcome,
      { subject: templates[outcome].subject, body: templates[outcome].body },
    ]),
  ),
});

export const roundValues = (round: Omit<Round, 'id' | 'programmeId'>): ConfigObject => ({
  title: round.title,
  opensAt: round.opensAt,
  closesAt: round.closesAt,
  timeZone: round.timeZone,
  currency: round.budget.currency,
  budget: { amountMinor: round.budget.amountMinor },
  awardMinimum: { amountMinor: round.awardMinimum.amountMinor },
  awardMaximum: { amountMinor: round.awardMaximum.amountMinor },
  latePolicy: round.latePolicy,
});

/** Stages and criteria by id, as a round's history records them. */
export const stageValues = (stages: readonly Stage[]): ConfigObject => ({
  stages: Object.fromEntries(
    stages.map(({ id, name, position, criteria }) => [
      id,
      {
        name,
        position,
        criteria: Object.fromEntries(
          criteria.map((criterion, index) => [
            criterion.id,
            {
              label: criterion.label,
              guidance: criterion.guidance,
              weight: criterion.weight,
              scaleMin: criterion.scaleMin,
              scaleMax: criterion.scaleMax,
              position: index + 1,
            },
          ]),
        ),
      },
    ]),
  ),
});

/** The column each of a programme's or round's own diff paths is stored in. */
export const programmeColumns = {
  title: 'title',
  summary: 'summary',
  description: 'description',
  status: 'status',
} as const;

export const roundColumns = {
  title: 'title',
  opensAt: 'opens_at',
  closesAt: 'closes_at',
  timeZone: 'timezone',
  currency: 'currency',
  'budget.amountMinor': 'budget_minor',
  'awardMinimum.amountMinor': 'award_min_minor',
  'awardMaximum.amountMinor': 'award_max_minor',
  latePolicy: 'late_policy',
} as const;

/** Audit changes with the old and new values of the columns a diff changed. */
export function columnChanges(
  table: 'grants.programme' | 'grants.round',
  columns: Readonly<Record<string, string>>,
  diff: ConfigDiff,
): AuditChanges {
  return Object.fromEntries(
    diff.flatMap(({ path, from, to }) => {
      const column = columns[path];
      return column === undefined ? [] : [[`${table}.${column}`, { before: from, after: to }]];
    }),
  );
}

/** Audit changes naming the stage and criterion columns a diff changed, with no values. */
export function stageFields(diff: ConfigDiff): AuditChanges {
  return Object.fromEntries(
    diff.map(({ path }) => {
      const names = path.split('.');
      const column = (names.at(-1) ?? '').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      return [`grants.${names.includes('criteria') ? 'rubric_criterion' : 'stage'}.${column}`, {}];
    }),
  );
}
