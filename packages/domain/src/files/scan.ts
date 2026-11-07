// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rescans and the changes of scan state (ADR 0030, amending ADR 0047). A
// file is scanned again at download, and by the daily withheld recheck,
// when clamd's signatures are newer than its last scan. A match withholds a
// clean file and never destroys it. An erased file (its erasure time set)
// changes no more, whatever its state; the database enforces that, not
// this list.

import { z } from 'zod';

import type { ScanState } from './view.ts';

/** clamd's signature database version, the number in its `VERSION` reply. */
export const signatureVersionSchema = z.int().positive();

/** How long the API keeps clamd's signature version before asking again. */
export const SIGNATURE_VERSION_TTL_SECONDS = 60;

/**
 * Whether a file last scanned under `lastVersion` must be scanned again
 * before it is served or restored. A file scanned before versions were
 * recorded has none, so it is scanned again.
 */
export function needsRescan(lastVersion: number | null, currentVersion: number): boolean {
  return lastVersion === null || currentVersion > lastVersion;
}

/**
 * The only changes of state, as `app.file`'s trigger allows them: a pending
 * file gets its one verdict, and a final file never changes. ADR 0030's
 * `withheld` state and its changes join this list and `scanStates` with the
 * migration that lets the database store them, never before.
 */
export const scanStateChanges: Readonly<Record<ScanState, readonly ScanState[]>> = {
  pending: ['clean', 'infected', 'error'],
  clean: [],
  infected: [],
  error: [],
};

export function canChangeScanState(from: ScanState, to: ScanState): boolean {
  return scanStateChanges[from].includes(to);
}
