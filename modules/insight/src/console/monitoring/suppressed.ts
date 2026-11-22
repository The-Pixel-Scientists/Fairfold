// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a hidden figure reads. One place, so the wording changes in one line
// if the contract comes to tell primary and secondary suppression apart.

import type { MonitoringCell } from '../../contracts/index.ts';

export const suppressedText = (threshold: number) => `Fewer than ${String(threshold)}`;

/** A cell in words: its count, or that it is hidden. Never a number for a hidden cell. */
export function cellText(cell: MonitoringCell, threshold: number): string {
  return cell.suppressed ? suppressedText(threshold) : cell.count.toLocaleString('en-GB');
}
