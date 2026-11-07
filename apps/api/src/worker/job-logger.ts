// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The logger the job wrapper gets. It keeps queue name, job id, request id,
// error code and payload paths only, never the error itself, so no message
// from Postgres reaches a log, and counts each failure by queue and code.

import type { JobLogger } from '@pixel-scientists/db/jobs';

import { recordJobFailure } from '../telemetry/index.ts';

interface Log {
  error(fields: Record<string, unknown>, message: string): void;
}

export function jobLogger(log: Log): JobLogger {
  return {
    error({ queue, jobId, requestId, code, paths }, message) {
      if (typeof queue === 'string' && typeof code === 'string') recordJobFailure({ queue, code });
      log.error({ queue, jobId, requestId, code, paths }, message);
    },
  };
}
