// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The warehouse model against the real classification map: every column's
// sources are classified, and which columns leave the system changes only
// with this list. A renamed or mistyped source column fails here, and so
// does a source reclassified as personal, rather than its column quietly
// dropping out of the snapshot.

import { classification } from '@pixel-scientists/db/classification';
import { warehouseColumns, warehouseTableNames } from '@pixel-scientists/domain/warehouse';
import { describe, expect, it } from 'vitest';

describe('the warehouse columns the classification map lets through', () => {
  it('are every column of every table today, as each source is public or internal', () => {
    const emitted = Object.fromEntries(
      warehouseTableNames.map((name) => [name, warehouseColumns(name, classification)]),
    );
    expect(emitted).toEqual({
      organisation: [
        'id',
        'status',
        'name',
        'legal_form',
        'website',
        'org_id',
        'org_id_verified',
        'created_at',
      ],
      person: ['id', 'status', 'created_at'],
      programme: ['id', 'source_module', 'title', 'summary', 'status', 'created_at'],
      commitment: [
        'id',
        'source_module',
        'programme_id',
        'organisation_id',
        'amount_minor',
        'currency',
        'committed_on',
      ],
      date: ['date', 'year', 'quarter', 'month', 'fiscal_year', 'fiscal_quarter'],
      grants_round: [
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
      ],
      grants_application: [
        'id',
        'round_id',
        'organisation_id',
        'applicant_person_id',
        'status',
        'submitted_at',
        'submitted_late',
        'withdrawn_at',
        'outcome',
        'commitment_id',
        'created_at',
      ],
      grants_score: [
        'id',
        'application_id',
        'round_id',
        'stage_id',
        'assignment_id',
        'criterion_id',
        'criterion',
        'weight',
        'score',
        'submitted_at',
      ],
    });
  });
});
