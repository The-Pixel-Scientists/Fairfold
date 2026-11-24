// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the insight handlers read from the platform (ADR 0016). The module
// never imports from the API or from another module's server: the API passes
// in what a handler needs from the request and from grants.

import type { AuditChanges, Transaction } from '@pixel-scientists/db';
import type { DB } from '@pixel-scientists/db/generated/insight';
import type { WarehouseTableName } from '@pixel-scientists/domain/warehouse';

import type { InsightAuditAction, ReportDefinitionChange } from '../contracts/index.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = Transaction<unknown>;

type InsightTables = { [Table in keyof DB]: DB[Table] };

/** The transaction typed to the insight tables. */
export function insightDb(tx: Tx) {
  return tx.$extendTables<InsightTables>();
}

export type InsightDb = ReturnType<typeof insightDb>;

/** One changed value of the disclosure rule, as its configuration version records it. */
export interface DisclosureChange {
  readonly field: 'threshold' | 'minimumGroup';
  readonly from: number;
  readonly to: number;
}

/** What a handler reads from the request context. */
export interface InsightContext {
  readonly audit: {
    record(event: {
      readonly action: InsightAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
  /** Writes the entity's next configuration version (rule 10) in the request's transaction. */
  readonly config: {
    record(
      entityType: 'insight.report_definition',
      entityId: string,
      diff: ReportDefinitionChange[],
    ): Promise<void>;
    record(
      entityType: 'insight.disclosure_rule',
      entityId: string,
      diff: DisclosureChange[],
    ): Promise<void>;
  };
  readonly membership: { readonly id: string };
  /** The request's id, which a job sent from it carries for log correlation. */
  readonly requestId: string;
  /**
   * Runs `work` once the request has committed. A failure there answers the
   * request, so a refusal can be given after what it records is kept.
   */
  readonly afterCommit: (work: () => Promise<void>) => void;
}

/**
 * Grants' counts of a round's monitoring answers, before any suppression
 * (ADR 0032). The result is special category data: it goes straight to the
 * suppression function and nowhere else.
 */
export type MonitoringCounts =
  | { readonly status: 'grants_off' }
  | {
      readonly status: 'counted';
      readonly rounds: readonly {
        readonly roundId: string;
        readonly responses: number;
        readonly questions: readonly {
          readonly fieldId: string;
          readonly options: readonly { readonly value: string; readonly count: number }[];
        }[];
      }[];
    };

/** One row of a warehouse table, by column name. */
export type WarehouseRow = Readonly<Record<string, string | number | boolean | null>>;

/**
 * A warehouse table as the warehouse feeds it, with only the columns its data
 * contract lets through: public and internal ones, never personal data.
 */
export type WarehouseRead =
  | { readonly status: 'off' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'rows';
      readonly columns: readonly string[];
      readonly rows: readonly WarehouseRow[];
    };

/** What the platform passes in. */
export interface InsightDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
  /** Grants' own server counts the answers, in the request's transaction (ADR 0016). */
  readonly monitoringCounts: (tx: Tx, roundIds: readonly string[]) => Promise<MonitoringCounts>;
  /** The warehouse's rows of one table, read in the request's transaction. */
  readonly warehouseRows: (tx: Tx, table: WarehouseTableName) => Promise<WarehouseRead>;
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: InsightContext;
  readonly input: I;
}

export interface ReportParams {
  readonly params: { readonly reportId: string };
}

export const iso = (time: Date): string => time.toISOString();

const UNIQUE_VIOLATION = '23505';

/** Whether a statement failed because a row like it is already there. */
export function isTaken(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
