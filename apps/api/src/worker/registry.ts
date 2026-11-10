// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one place handlers are attached. Platform handlers come from jobs/,
// module handlers are passed in at start. startWorker() refuses, before it
// connects, a queue not made by defineQueue() or given two handlers.

import {
  defineHandler,
  type JobHandler,
  type Queue,
  type RunningJob,
} from '@pixel-scientists/db/jobs';
import type { Transaction } from '@pixel-scientists/db';
import type { z } from 'zod';

import type { FilesJobDependencies } from '../platform/files/index.ts';
import type { RunLogger } from './job-logger.ts';
import { platformHandlers } from './jobs/index.ts';

/** A module's tenant handler, which checks its module is on inside the transaction. */
export interface ModuleJob<S extends z.ZodObject = z.ZodObject> {
  readonly queue: Queue<S, 'tenant'>;
  readonly handler: (trx: Transaction<unknown>, job: RunningJob<z.output<S>>) => Promise<void>;
}

export function handlerRegistry(
  logger: RunLogger,
  modules: readonly ModuleJob[],
  files?: FilesJobDependencies,
): readonly JobHandler<unknown>[] {
  return [
    ...platformHandlers(logger, files),
    ...modules.map(({ queue, handler }) =>
      defineHandler<unknown, z.ZodObject, 'tenant'>(queue, handler),
    ),
  ];
}
