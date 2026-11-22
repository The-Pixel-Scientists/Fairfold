// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a module gives the approval engine for each workflow it ships (ADR
// 0038, ADR 0016): the definition, and the way to reach its subjects. A
// request names no subject, so the module's own link table is the only
// way from a request to a record, and its scope rule (ADR 0037) the only
// judge of who may reach it.

import type { WorkflowDefinition } from '@pixel-scientists/domain/workflow';

import type { TenantTransaction } from '../../database.ts';

/** The caller, from the session. */
export interface Reader {
  readonly userId: string;
  readonly membershipId: string;
}

export interface ApprovalSubjects {
  /**
   * The subject of each of `requestIds` that the reader reaches through the
   * module's link table and scope rule, without break-glass: request id to
   * subject id. A request with no link, or one the reader does not reach,
   * is left out, and reads as a missing one.
   */
  reach(
    tx: TenantTransaction,
    reader: Reader,
    requestIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  /** The party a subject is about, for the audit event (ADR 0027), where it is about one. */
  partyId?(tx: TenantTransaction, subjectId: string): Promise<string | null>;
}

export interface ApprovalKind {
  /** As shipped, at version 1. A tenant's stored versions may only raise approver counts. */
  readonly definition: WorkflowDefinition;
  readonly subjects: ApprovalSubjects;
}

/** Every module's workflows, one line each, once its link table and scope rule exist. */
export const approvalKinds: readonly ApprovalKind[] = [];
