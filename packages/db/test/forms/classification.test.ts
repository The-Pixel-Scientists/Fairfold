// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A response's answers are classified field by field from the version it
// pinned (rule 5, ADR 0027): the map names the pinned definition, and each
// stored answer, read through it, takes its own question's class, special
// category and aggregate-only questions included.

import { parseDefinition } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { classification } from '../../classification.ts';
import { classifyAnswers } from '../../src/classification-answers.ts';
import { asMigratorIn, createTestTenant, insertRow } from '../tenants.ts';
import {
  addFormsParts,
  formRow,
  publishVersion,
  responseRow,
  SIGNED_IN_DEFINITION,
} from './fixtures.ts';

describe('forms.response answers', { timeout: 30_000 }, () => {
  it('are classified per field from the pinned version', () => {
    expect(classification['forms.response']?.['answers']).toEqual({
      sensitivity: 'special_category',
      retention: { kind: 'fixed', days: 1, from: 'retain_until' },
      perField: {
        versionColumn: 'form_version_id',
        definition: { table: 'forms.form_version', column: 'definition' },
      },
    });
  });

  it('each take their question class, special category and aggregate-only included', async () => {
    const tenant = await createTestTenant();
    const stored = await asMigratorIn(tenant.id, async (client) => {
      const parts = await addFormsParts(client, tenant);
      const form = await insertRow(
        client,
        'forms.form',
        formRow(tenant, parts.member, { respondents: 'signed_in' }),
      );
      const version = await publishVersion(client, tenant, form, parts.member, {
        definition: JSON.stringify(SIGNED_IN_DEFINITION),
      });
      const answers = {
        f_name: 'Synthetic Person',
        f_rating: 3,
        f_venue: 'south',
        f_health: false,
      };
      const id = await insertRow(
        client,
        'forms.response',
        responseRow(tenant, { ...parts, form, version }, { answers: JSON.stringify(answers) }),
      );
      const { rows } = await client.query<{
        definition: unknown;
        answers: Record<string, unknown>;
      }>(
        `SELECT v.definition, r.answers
           FROM forms.response r
           JOIN forms.form_version v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
          WHERE r.id = $1`,
        [id],
      );
      return rows[0];
    });
    const parsed = parseDefinition(stored?.definition);
    if (!parsed.success) throw new Error('The pinned definition does not parse.');
    const classes = Object.fromEntries(
      Object.entries(classifyAnswers(parsed.data, stored?.answers ?? {})).map(([id, answer]) => [
        id,
        answer.classification,
      ]),
    );
    expect(classes).toEqual({
      f_name: 'personal',
      f_rating: 'internal',
      f_venue: 'public',
      f_health: 'special_category',
    });
    const health = parsed.data.sections[0]?.fields.find((field) => field.id === 'f_health');
    expect(health && 'audiences' in health ? health.audiences : undefined).toBe('aggregate_only');
  });
});
