// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Search providers (ADR 0025). A module that offers search exports one
// provider for each kind of record it returns: what it matches on, who may
// use it, and the audit action a read of its results writes. The server fans
// a term out to the providers of the modules switched on for the tenant whose
// permission and scopes the caller holds (S12-16), and each matches only on
// searchableFields() for the caller's audience.
//
// No table is defined here. Indexed and generated search columns (S12-04) are
// classified as their source column, with its retention rule, and their
// cross-tenant denial tests belong to S12-04 and S12-16.

import type { ProjectionAudience } from '../../forms/audience.ts';
import type { Id } from '../../id.ts';
import { permissions, type Permission, type ScopeRule } from '../access.ts';
import { isAuditAction, type AuditAction } from '../audit.ts';
import type { ModuleId } from '../modules.ts';
import type { SearchTerm } from './term.ts';

/** Who searches. Never the applicant: the portal has no search. */
export const searchAudiences = [
  'staff',
  'reviewer',
  'blind_reviewer',
] as const satisfies readonly ProjectionAudience[];

export type SearchAudience = (typeof searchAudiences)[number];

/** The classification map's sensitivity levels, mirrored so this package stays browser-safe. */
export const sensitivities = ['public', 'internal', 'personal', 'special_category'] as const;

export type Sensitivity = (typeof sensitivities)[number];

/** The only kinds a reviewer reaches, under the `assigned_review` scope. */
export const reviewerKinds = ['grants.application'] as const;

export type ReviewerKind = (typeof reviewerKinds)[number];

/** `<module>.<entity>`, such as `party.organisation`. */
export type SearchKind<M extends ModuleId = ModuleId> = `${M}.${string}`;

export interface SearchField {
  /** The column matched on, such as `match_name`. */
  readonly id: string;
  /** The source column's level in the classification map; S12-16's server test compares them. */
  readonly sensitivity: Sensitivity;
  /** Who may match on it, or `aggregate_only` for a form answer nobody reads singly. */
  readonly audiences: readonly SearchAudience[] | 'aggregate_only';
  /** Names or identifies an applicant, so blind reviewers never match on it. */
  readonly identity?: boolean;
  /** A form answer. No answer is searchable in v1. */
  readonly answer?: boolean;
}

interface ModuleSearchProvider<M extends ModuleId> {
  readonly module: M;
  readonly kind: SearchKind<M>;
  /** A console permission the caller must hold, and the scope rules that narrow the results. */
  readonly permission: Permission;
  readonly scopes: readonly ScopeRule[];
  readonly audiences: readonly SearchAudience[];
  readonly fields: readonly SearchField[];
  /** The highest level of the columns a result's label is built from, such as a person's name. */
  readonly label: Sensitivity;
  /**
   * The sensitive-read action from the module's own audit list, required when
   * the label or a field is personal. The server writes it with the result ids
   * only: the term is never an audit value.
   */
  readonly readAction?: AuditAction<M>;
}

export type SearchProvider = { [M in ModuleId]: ModuleSearchProvider<M> }[ModuleId];

/**
 * What a provider is asked. The tenant, membership and permissions are not
 * here: the server takes them from the tenant transaction (rule 6).
 */
export interface SearchRequest {
  readonly term: SearchTerm;
  readonly audience: SearchAudience;
  readonly limit: number;
}

/** One match. The label is built only from what the audience may see. */
export interface SearchHit<K extends string = SearchKind> {
  readonly kind: K;
  readonly id: Id;
  readonly label: string;
  readonly module: ModuleId;
}

/** A provider's search, implemented by its module's server. */
export type SearchFunction<P extends SearchProvider = SearchProvider> = (
  request: SearchRequest,
) => Promise<readonly SearchHit<P['kind']>[]>;

const KIND = /^[a-z]+\.[a-z][a-z_]*$/;
const FIELD_ID = /^[a-z][a-z0-9_]{0,62}$/;

function isListOf(values: readonly unknown[], allowed: readonly string[]): boolean {
  return (
    values.length > 0 &&
    new Set(values).size === values.length &&
    values.every((value) => allowed.includes(value as string))
  );
}

function fieldProblems(field: SearchField): string[] {
  const name = `The field ${field.id}`;
  const problems: string[] = [];
  if (!sensitivities.includes(field.sensitivity)) {
    problems.push(`${name} has no known sensitivity.`);
  }
  if (field.sensitivity === 'special_category') {
    problems.push(`${name} is special category data, which is never searchable.`);
  }
  if (field.answer === true) problems.push(`${name} is a form answer, which is not searchable.`);
  if (field.audiences === 'aggregate_only') {
    problems.push(`${name} is aggregate only, so nobody may match on it.`);
  } else if (!isListOf(field.audiences, searchAudiences)) {
    problems.push(`${name} lists staff, reviewer or blind_reviewer, each once.`);
  } else if (field.audiences.includes('blind_reviewer')) {
    if (field.identity === true) {
      problems.push(`${name} identifies an applicant, so blind reviewers may not match on it.`);
    }
    if (field.sensitivity === 'personal') {
      problems.push(`${name} is personal data, so blind reviewers may not match on it.`);
    }
    if (!field.audiences.includes('reviewer')) {
      problems.push(`${name} lists blind_reviewer, so it must list reviewer too.`);
    }
  }
  return problems;
}

/** Everything wrong with a provider, as sentences. Empty when it keeps every rule. */
export function checkSearchProvider(provider: SearchProvider): string[] {
  const { module, kind, permission, scopes, audiences, fields, label, readAction } = provider;
  const problems: string[] = [];
  if (!KIND.test(kind) || !kind.startsWith(`${module}.`)) {
    problems.push(`The kind ${kind} must be ${module}.<entity> in lower case.`);
  }
  const granted = Object.hasOwn(permissions, permission) ? permissions[permission] : undefined;
  if (granted?.app !== 'console') {
    problems.push(`${permission} is not a console permission.`);
  } else if (!isListOf(scopes, granted.scopes)) {
    problems.push(`The scopes must be among those of ${permission}: ${granted.scopes.join(', ')}.`);
  }
  if (!isListOf(audiences, searchAudiences)) {
    problems.push('A provider serves staff, reviewer or blind_reviewer, each once.');
  }
  const forReviewers = audiences.some(
    (audience) => audience === 'reviewer' || audience === 'blind_reviewer',
  );
  const reviewerKind = (reviewerKinds as readonly string[]).includes(kind);
  if (forReviewers && (!reviewerKind || scopes.join() !== 'assigned_review')) {
    problems.push(
      `A provider for reviewers returns ${reviewerKinds.join(', ')} under assigned_review only.`,
    );
  }
  const ids = fields.map((field) => field.id);
  if (
    fields.length === 0 ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => FIELD_ID.test(id))
  ) {
    problems.push('A provider matches on one or more fields, each with its own lower case id.');
  }
  problems.push(...fields.flatMap(fieldProblems));
  if (!sensitivities.includes(label) || label === 'special_category') {
    problems.push('The label is built from public, internal or personal data only.');
  }
  const personal = label === 'personal' || fields.some((field) => field.sensitivity === 'personal');
  const ownAction =
    readAction !== undefined && readAction.startsWith(`${module}.`) && isAuditAction(readAction);
  if (readAction === undefined ? personal : !ownAction) {
    problems.push(
      `A personal label or field needs a read action, which comes from the ${module} audit actions.`,
    );
  }
  return problems;
}

/** Returns the provider unchanged, or throws if it breaks a rule. */
export function defineSearchProvider<const P extends SearchProvider>(provider: P): P {
  const problems = checkSearchProvider(provider);
  if (problems.length > 0) {
    throw new Error(
      `The ${provider.kind} search provider breaks the rules:\n- ${problems.join('\n- ')}`,
    );
  }
  return provider;
}

/**
 * The fields an audience may match on, by the rules canSee() keeps for
 * answers: nobody matches on special category data, form answers or
 * aggregate-only fields, and each audience only on fields that list it.
 * Blind reviewers match only on fields that also list reviewer, and never on
 * identity or personal fields, because a match alone can name the applicant.
 */
export function searchableFields(provider: SearchProvider, audience: SearchAudience): string[] {
  if (!provider.audiences.includes(audience)) return [];
  return provider.fields
    .filter(
      (field) =>
        field.sensitivity !== 'special_category' &&
        field.answer !== true &&
        field.audiences !== 'aggregate_only' &&
        field.audiences.includes(audience) &&
        !(
          audience === 'blind_reviewer' &&
          (field.identity === true ||
            field.sensitivity === 'personal' ||
            !field.audiences.includes('reviewer'))
        ),
    )
    .map((field) => field.id);
}
