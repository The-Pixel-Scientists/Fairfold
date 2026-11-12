// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the impact handlers read from the platform (ADR 0016). The module
// never imports from the API: the API passes in what a handler needs from
// the request and from other modules.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/impact';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { FrameworkChange, ImpactAuditAction } from '../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

/** The file columns a result's evidence is checked against (ADR 0030). */
type FileTables = {
  'app.file': {
    id: string;
    scan_state: string;
    linked_at: Date | null;
    erased_at: Date | null;
  };
};

/**
 * A table whose period is read and compared as text, `YYYY-MM-DD`: pg would
 * otherwise read a date as a time in the server's zone. Every select casts
 * the two columns to text.
 */
type Dated<T> = Omit<T, 'period_start' | 'period_end'> & {
  period_start: string;
  period_end: string;
};

type ImpactTables = Omit<DB, 'impact.target' | 'impact.result'> & {
  'impact.target': Dated<DB['impact.target']>;
  'impact.result': Dated<DB['impact.result']>;
} & FileTables;

/** The transaction typed to the impact tables. */
export function impactDb(tx: Tx) {
  return tx.$extendTables<ImpactTables>();
}

export type ImpactDb = ReturnType<typeof impactDb>;

/** What a handler reads from the request context. */
export interface ImpactContext {
  readonly audit: {
    record(event: {
      readonly action: ImpactAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
  /** Writes the framework's next configuration version (rule 10) in the request's transaction. */
  readonly config: {
    record(
      entityType: 'impact.framework',
      entityId: string,
      diff: FrameworkChange[],
    ): Promise<void>;
  };
  readonly membership: { readonly id: string };
}

/** What the platform passes in. */
export interface ImpactDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words, with the fields at fault. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  /** Whether the tenant has the programme, through grants' own server (ADR 0016). */
  readonly programmeExists: (tx: Tx, programmeId: string) => Promise<boolean>;
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: ImpactContext;
  readonly input: I;
}

export interface FrameworkParams {
  readonly params: { readonly frameworkId: string };
}

const UNIQUE_VIOLATION = '23505';

/** Whether a statement failed because a row like it is already there. */
export function isTaken(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** A figure as the database holds it, which pg reads as text. */
export const figure = (value: string): number => Number(value);

export const iso = (time: Date): string => time.toISOString();
