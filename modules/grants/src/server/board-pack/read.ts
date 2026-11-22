// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a board pack may hold, decided from the data and never from the
// request (rules 6, 7, 8 and ADR 0004). The same functions run when a pack
// is requested and again when the job runs, so access removed since the
// request narrows the pack and access added never widens it.
//
// The fixed details of an application are columns of the classification
// map. A blind reviewer gets no organisation. A decision appears only once
// it is released, or to a member who may record decisions, so an unreleased
// decision reads as no decision to anyone else. Answers come through the
// pinned form version and the template's audience: special category and
// aggregate-only answers never pass, whatever a template names.

import {
  answerClassifications,
  classifications,
  formDefinitionSchema,
  type Answers,
  type FormDefinition,
  type Classification,
  type ProjectionAudience,
} from '@pixel-scientists/domain/forms';
import { documentFields, type TemplateVersion } from '@pixel-scientists/domain/documents';

import type { Outcome } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { boardPackDb } from './tables.ts';

export type Audience = Extract<ProjectionAudience, 'staff' | 'reviewer' | 'blind_reviewer'>;

/** Who the pack is for: their audience, and whether they may record decisions. */
export interface Requester {
  readonly audience: Audience;
  readonly mayRecordDecisions: boolean;
}

export interface SelectedApplication {
  readonly id: string;
  readonly programmeTitle: string;
  readonly roundTitle: string;
  readonly status: string;
  readonly submittedAt: Date | null;
  readonly snapshotId: string | null;
  readonly answers: Answers;
  readonly definition: FormDefinition;
  readonly decision: {
    readonly outcome: Outcome;
    readonly amountMinor: string | null;
    readonly released: boolean;
  } | null;
}

const FACTS = [
  'grants.programme.title',
  'grants.round.title',
  'grants.application.status',
  'grants.application.submitted_at',
] as const;
const ORGANISATION = 'party.organisation_snapshot.name';
const DECISION = ['grants.decision.outcome', 'grants.decision.amount_minor'] as const;

/**
 * The submitted applications of the tenant, in the order asked, or undefined
 * if any id is not one: a draft, another tenant's and an unknown id all read
 * the same, and a partial pack is never made. Row-level security keeps the
 * query inside the tenant.
 */
export async function selectApplications(
  tx: Tx,
  ids: readonly string[],
): Promise<SelectedApplication[] | undefined> {
  const rows = await boardPackDb(tx)
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .innerJoin('grants.programme as p', 'p.id', 'r.programme_id')
    .innerJoin('grants.form_version as f', 'f.id', 'a.form_version_id')
    .leftJoin('grants.decision as d', 'd.application_id', 'a.id')
    .select([
      'a.id',
      'a.status',
      'a.submitted_at',
      'a.organisation_snapshot_id',
      'a.answers',
      'f.definition',
      'p.title as programme_title',
      'r.title as round_title',
      'd.outcome',
      'd.amount_minor',
      'd.released_at',
    ])
    .where('a.id', 'in', ids)
    .where('a.status', '<>', 'draft')
    .execute();
  if (rows.length !== ids.length) return undefined;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected: SelectedApplication[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    // Parsed again, whatever was stored, so the engine's defaults and limits always hold.
    const definition = formDefinitionSchema.safeParse(row?.definition);
    if (row === undefined || !definition.success) return undefined;
    selected.push({
      id,
      programmeTitle: row.programme_title,
      roundTitle: row.round_title,
      status: row.status,
      submittedAt: row.submitted_at,
      snapshotId: row.organisation_snapshot_id,
      answers: row.answers as Answers,
      definition: definition.data,
      decision:
        row.outcome === null
          ? null
          : {
              outcome: row.outcome,
              amountMinor: row.amount_minor,
              released: row.released_at !== null,
            },
    });
  }
  return selected;
}

/** Whether the requester sees the application's decision: released, or theirs to record. */
export const showsDecision = (
  requester: Requester,
  application: SelectedApplication,
): application is SelectedApplication & {
  decision: NonNullable<SelectedApplication['decision']>;
} =>
  application.decision !== null && (application.decision.released || requester.mayRecordDecisions);

export const showsOrganisation = (requester: Requester): boolean =>
  requester.audience !== 'blind_reviewer';

/** The template's merge fields this requester may have on this application. */
export function allowedMergeFields(
  template: TemplateVersion,
  requester: Requester,
  application: SelectedApplication,
): string[] {
  const { notShown } = documentFields(
    template,
    application.definition,
    application.answers,
    requester.audience,
    template.mergeFields,
  );
  const refused = new Set(notShown);
  return template.mergeFields.filter((id) => !refused.has(id));
}

export interface PackFields {
  /** Every column and form field the pack can hold: the job request's field list. */
  readonly fieldIds: string[];
  /** The highest class each form field has in any pinned version. */
  readonly answerClasses: Record<string, Classification>;
}

/** The field list of a pack, for the request to write and for the job to check against it. */
export function packFields(
  template: TemplateVersion,
  requester: Requester,
  applications: readonly SelectedApplication[],
): PackFields {
  const fieldIds = new Set<string>(FACTS);
  if (showsOrganisation(requester) && applications.some((a) => a.snapshotId !== null)) {
    fieldIds.add(ORGANISATION);
  }
  if (applications.some((a) => showsDecision(requester, a))) {
    for (const id of DECISION) fieldIds.add(id);
  }
  const answerClasses: PackFields['answerClasses'] = {};
  for (const application of applications) {
    const classes = answerClassifications(application.definition);
    for (const id of allowedMergeFields(template, requester, application)) {
      fieldIds.add(id);
      const held = answerClasses[id];
      const next = classes[id];
      if (next !== undefined && (held === undefined || rank(next) > rank(held))) {
        answerClasses[id] = next;
      }
    }
  }
  return { fieldIds: [...fieldIds], answerClasses };
}

const rank = (classification: Classification): number => classifications.indexOf(classification);
