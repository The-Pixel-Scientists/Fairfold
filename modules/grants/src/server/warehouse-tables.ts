// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's own warehouse tables (ADR 0016), kept apart from the
// shared ones so they can be dropped together. A draft is the applicant's
// own unsubmitted work and is never read. An application shows its outcome
// only once released; a score comes only from a submitted review, without
// its comment or its reviewer.

import type { WarehouseContribution } from '@pixel-scientists/domain/warehouse';

import type { Tx } from './programme/tables.ts';
import { iso, isoOrNull, required } from './warehouse-values.ts';

/** The columns these readers use (migrations 0009, 0011, 0012 and 0013). */
type Sources = {
  'grants.round': {
    id: string;
    programme_id: string;
    title: string;
    opens_at: Date;
    closes_at: Date;
    budget_minor: string;
    award_min_minor: string;
    award_max_minor: string;
    currency: string;
    created_at: Date;
  };
  'grants.application': {
    id: string;
    round_id: string;
    organisation_id: string;
    applicant_person_id: string;
    status: string;
    submitted_at: Date | null;
    submitted_late: boolean;
    withdrawn_at: Date | null;
    created_at: Date;
  };
  'grants.assignment': {
    id: string;
    application_id: string;
    round_id: string;
    status: string;
    submitted_at: Date | null;
  };
  'grants.rubric_criterion': { id: string; label: string; weight: number };
  'grants.score': {
    id: string;
    assignment_id: string;
    stage_id: string;
    criterion_id: string;
    score: number;
  };
  'grants.decision': {
    id: string;
    application_id: string;
    outcome: string;
    released_at: Date | null;
  };
};

export const grantsModuleTables: Pick<
  WarehouseContribution<'grants', Tx>['tables'],
  'grants_round' | 'grants_application' | 'grants_score'
> = {
  async grants_round(tx) {
    const rows = await tx
      .$extendTables<Sources>()
      .selectFrom('grants.round')
      .select([
        'id',
        'programme_id',
        'title',
        'opens_at',
        'closes_at',
        'budget_minor',
        'award_min_minor',
        'award_max_minor',
        'currency',
        'created_at',
      ])
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      ...row,
      opens_at: iso(row.opens_at),
      closes_at: iso(row.closes_at),
      budget_minor: Number(row.budget_minor),
      award_min_minor: Number(row.award_min_minor),
      award_max_minor: Number(row.award_max_minor),
      created_at: iso(row.created_at),
    }));
  },

  async grants_application(tx) {
    const rows = await tx
      .$extendTables<Sources>()
      .selectFrom('grants.application as a')
      .leftJoin('grants.decision as d', (join) =>
        join.onRef('d.application_id', '=', 'a.id').on('d.released_at', 'is not', null),
      )
      .select([
        'a.id',
        'a.round_id',
        'a.organisation_id',
        'a.applicant_person_id',
        'a.status',
        'a.submitted_at',
        'a.submitted_late',
        'a.withdrawn_at',
        'd.outcome',
        'd.id as decision_id',
        'a.created_at',
      ])
      .where('a.status', '<>', 'draft')
      .orderBy('a.created_at')
      .orderBy('a.id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      round_id: row.round_id,
      organisation_id: row.organisation_id,
      applicant_person_id: row.applicant_person_id,
      status: row.status,
      submitted_at: iso(required(row.submitted_at)),
      submitted_late: row.submitted_late,
      withdrawn_at: isoOrNull(row.withdrawn_at),
      outcome: row.outcome,
      commitment_id: row.outcome === 'accepted' ? row.decision_id : null,
      created_at: iso(row.created_at),
    }));
  },

  async grants_score(tx) {
    const rows = await tx
      .$extendTables<Sources>()
      .selectFrom('grants.score as s')
      .innerJoin('grants.assignment as g', 'g.id', 's.assignment_id')
      .innerJoin('grants.rubric_criterion as c', 'c.id', 's.criterion_id')
      .select([
        's.id',
        'g.application_id',
        'g.round_id',
        's.stage_id',
        's.assignment_id',
        's.criterion_id',
        'c.label as criterion',
        'c.weight',
        's.score',
        'g.submitted_at',
      ])
      .where('g.status', '=', 'submitted')
      .orderBy('g.submitted_at')
      .orderBy('s.id')
      .execute();
    return rows.map((row) => ({ ...row, submitted_at: iso(required(row.submitted_at)) }));
  },
};
