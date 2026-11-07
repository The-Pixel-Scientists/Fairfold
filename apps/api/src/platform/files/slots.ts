// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The scan slots of one API process (ADR 0047, ADR 0030): uploads and
// rescans at download share them, and a request that finds none free is
// answered at once with a 503, never queued.

import { fileRefusalMessages } from '@pixel-scientists/domain/files';

import { ApiError } from '../../problems.ts';

export interface Slots {
  /** Runs `work` in a free slot, or throws a 503 with Retry-After. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createSlots(max: number): Slots {
  let running = 0;
  return {
    async run(work) {
      if (running >= max) {
        throw new ApiError(503, fileRefusalMessages.scanner_busy, {
          reason: 'scanner_busy',
          headers: { 'retry-after': '5' },
        });
      }
      running++;
      try {
        return await work();
      } finally {
        running--;
      }
    },
  };
}
