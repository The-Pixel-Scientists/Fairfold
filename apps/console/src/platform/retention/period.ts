// SPDX-License-Identifier: AGPL-3.0-or-later

import { retentionPolicyLabels } from '@pixel-scientists/domain/platform/retention';

const plural = (count: number, noun: string) =>
  `${count.toLocaleString('en-GB')} ${noun}${count === 1 ? '' : 's'}`;

/** A period in plain units: whole years when it is, otherwise days. */
export function periodWords(days: number): string {
  return days >= 365 && days % 365 === 0 ? plural(days / 365, 'year') : plural(days, 'day');
}

/** The name of a policy's data, from the catalogue; a policy it does not list shows its key. */
export const policyName = (labelKey: string): string => retentionPolicyLabels[labelKey] ?? labelKey;
