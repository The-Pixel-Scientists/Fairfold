// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The jobs the worker takes from the modules (ADR 0009, ADR 0016). The grants
// release email job sends through the mail server the worker is given.

import { releaseEmailJob } from '../decision-emails.ts';
import { collectModuleJobs, type Mail } from '../modules.ts';
import type { ModuleJob } from './registry.ts';

export function workerModuleJobs(mail: Mail): readonly ModuleJob[] {
  return collectModuleJobs([{ jobs: [releaseEmailJob(mail)] }]);
}
