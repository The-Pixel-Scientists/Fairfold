// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The preparation job's work (ADR 0009), for the worker's job alone. The job
// holds a run's id and nothing else; everything is read here in the job's own
// tenant transaction as app_worker. The run's preparer must still be allowed
// to prepare it and insight must still be on. The output is built, stored,
// and the run becomes `prepared`, or `failed` with a code from a fixed list:
// no message or value is ever kept. Redelivery of a finished run does
// nothing. The job changes no grant, decision, application or round, and
// submits nothing to anyone (architecture rule 9).

import { attempt } from '@pixel-scientists/db';
import type { AuditChanges } from '@pixel-scientists/db';

import type { InsightAuditAction, PublicationKind } from '../../contracts/index.ts';
import { insightDb, type Tx } from '../context.ts';
import {
  annualReturnOutput,
  Failure,
  parseFigures,
  sorpNoteOutput,
  threeSixtyGivingOutput,
  type FailureCode,
  type Output,
} from './builders.ts';
import { moduleIsOn, runChanges, selectRuns } from './runs.ts';
import type { PublicationSources } from './sources.ts';

export interface PreparationDependencies {
  readonly sources: PublicationSources;
  /**
   * Stores the output in `app.file` as an internal file, in the job's transaction, and gives its
   * id. The file must be clean and never linked, as the run's trigger requires.
   */
  readonly storeOutput: (tx: Tx, output: Output) => Promise<string>;
  /** Whether the membership still holds the publication permission in this tenant. */
  readonly mayPrepare: (tx: Tx, membershipId: string) => Promise<boolean>;
}

export interface PrepareJob {
  readonly runId: string;
  /** Records an event in the job's transaction as the job: the system, the job id and the causing member. */
  readonly audit: (event: {
    readonly action: InsightAuditAction;
    readonly entityId: string;
    readonly changes: AuditChanges;
  }) => Promise<void>;
}

/** `done`: the run is prepared, failed or already finished. `missing`: no such run in this tenant. */
export type PrepareOutcome = 'done' | 'missing';

export function preparePublication(deps: PreparationDependencies) {
  async function build(tx: Tx, kind: PublicationKind, start: string, end: string) {
    const period = { start, end };
    if (kind === 'three_sixty_giving') {
      return threeSixtyGivingOutput(await deps.sources.threeSixtyGiving(tx, period));
    }
    const answer = await deps.sources.committedFigures(tx, period);
    if (answer.status === 'grants_off') throw new Failure('grants_off');
    const figures = parseFigures(answer.rows);
    return kind === 'sorp_grant_note'
      ? sorpNoteOutput(figures, period)
      : annualReturnOutput(figures, period);
  }

  return async (tx: Tx, job: PrepareJob): Promise<PrepareOutcome> => {
    const found = await selectRuns(tx).where('id', '=', job.runId).forUpdate().executeTakeFirst();
    if (found === undefined) return 'missing';
    if (found.state !== 'preparing') return 'done';
    const db = insightDb(tx);
    const run = {
      kind: found.kind as PublicationKind,
      periodStart: found.period_start,
      periodEnd: found.period_end,
    };

    const outcome: { code?: FailureCode } = {};
    if (!(await moduleIsOn(tx, 'insight'))) {
      outcome.code = 'module_off';
    } else if (!(await deps.mayPrepare(tx, found.prepared_by))) {
      outcome.code = 'not_allowed';
    } else {
      // A failure undoes the file and anything the sources wrote, and the run still records why.
      const finished = await attempt(tx, async () => {
        try {
          const output = await build(tx, run.kind, run.periodStart, run.periodEnd);
          const fileId = await deps.storeOutput(tx, output);
          await db
            .updateTable('insight.publication_run')
            .set({ state: 'prepared', output_file_id: fileId })
            .where('id', '=', job.runId)
            .execute();
        } catch (error) {
          outcome.code = error instanceof Failure ? error.code : 'output_failed';
          throw error;
        }
      });
      if (finished) outcome.code = undefined;
    }

    const { code } = outcome;
    if (code !== undefined) {
      await db
        .updateTable('insight.publication_run')
        .set({ state: 'failed', error_code: code })
        .where('id', '=', job.runId)
        .execute();
    }
    await job.audit({
      action: 'insight.publication_run.prepared',
      entityId: job.runId,
      changes: runChanges(
        { ...run, state: code === undefined ? 'prepared' : 'failed' },
        code === undefined ? {} : { 'insight.publication_run.error_code': { after: code } },
      ),
    });
    return 'done';
  };
}
