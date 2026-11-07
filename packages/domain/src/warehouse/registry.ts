// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The data contract registry (ADR 0016): one slot for each module that
// feeds the warehouse. Party and grants feed it in MVP1; each wave 1
// module's slot stays empty until its contribution task fills it. Every
// class here matches the classification map (packages/db/classification.ts),
// which the insight contracts' tests check.

import type { ModuleId } from '../platform/modules.ts';
import { defineDataContract, type DataContract } from './contract.ts';

const partyContract = defineDataContract('party', 1, {
  organisation: {
    id: 'internal',
    status: 'internal',
    name: 'internal',
    legal_form: 'internal',
    website: 'internal',
    org_id: 'internal',
    org_id_verified: 'internal',
    created_at: 'internal',
  },
  person: { id: 'internal', status: 'internal', created_at: 'internal' },
});

const grantsContract = defineDataContract('grants', 1, {
  programme: {
    id: 'internal',
    source_module: 'internal',
    title: 'public',
    summary: 'public',
    status: 'internal',
    created_at: 'internal',
  },
  commitment: {
    id: 'internal',
    source_module: 'internal',
    programme_id: 'internal',
    organisation_id: 'internal',
    amount_minor: 'internal',
    currency: 'internal',
    committed_on: 'internal',
  },
  grants_round: {
    id: 'internal',
    programme_id: 'internal',
    title: 'public',
    opens_at: 'public',
    closes_at: 'public',
    budget_minor: 'internal',
    award_min_minor: 'public',
    award_max_minor: 'public',
    currency: 'public',
    created_at: 'internal',
  },
  grants_application: {
    id: 'internal',
    round_id: 'internal',
    organisation_id: 'internal',
    applicant_person_id: 'internal',
    status: 'internal',
    submitted_at: 'internal',
    submitted_late: 'internal',
    withdrawn_at: 'internal',
    outcome: 'internal',
    commitment_id: 'internal',
    created_at: 'internal',
  },
  grants_score: {
    id: 'internal',
    application_id: 'internal',
    round_id: 'internal',
    stage_id: 'internal',
    assignment_id: 'internal',
    criterion_id: 'internal',
    criterion: 'internal',
    weight: 'internal',
    score: 'internal',
    submitted_at: 'internal',
  },
});

/** Null until the module's contribution is built (crm in S12-51, for example). */
export const dataContracts = {
  party: partyContract,
  grants: grantsContract,
  crm: null,
  assure: null,
  forms: null,
  privacy: null,
  insight: null,
} as const satisfies Partial<Record<ModuleId, DataContract | null>>;

export type DataContractModule = keyof typeof dataContracts;

/** The version a module's contribution emits, or never while its slot is empty. */
export type DataContractVersion<M extends ModuleId> = M extends DataContractModule
  ? (typeof dataContracts)[M] extends { readonly version: infer V }
    ? V
    : never
  : never;

/**
 * Everything wrong with a contribution against the registry, as sentences:
 * a module with no contract, or a contribution that names no version or
 * another one. The load script runs it before reading any rows.
 */
export function contributionProblems(contribution: {
  readonly module: ModuleId;
  readonly contractVersion?: number;
}): string[] {
  const { module, contractVersion } = contribution;
  const contract = Object.hasOwn(dataContracts, module)
    ? (dataContracts as Partial<Record<ModuleId, DataContract | null>>)[module]
    : null;
  if (!contract) return [`${module} has no data contract.`];
  if (contractVersion !== contract.version) {
    return [`The ${module} contribution must emit data contract version ${contract.version}.`];
  }
  return [];
}
