// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a submission's state is put in words and tags, so the list, the detail
// page and the tests say the same thing. Colour only backs the words up.

import { Tag } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';

import { eligibilityOutcomes, submissionStatuses } from '../../contracts/index.ts';
import type { EligibilityOutcome, SubmissionSummary } from '../../contracts/index.ts';

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "1 submission", "5 submissions". */
export const countOf = (count: number) =>
  `${String(count)} ${count === 1 ? 'submission' : 'submissions'}`;

/** "21 January 2027", in the browser's time zone. */
export function formatDay(iso: string): string {
  return dayFormat.format(new Date(iso));
}

const statusTones = { submitted: 'info', withdrawn: 'neutral' } as const;
const eligibilityTones = { eligible: 'success', stopped: 'danger' } as const;

export function StatusTag({ status }: { status: SubmissionSummary['status'] }) {
  return <Tag tone={statusTones[status]}>{submissionStatuses[status]}</Tag>;
}

export function EligibilityTag({ outcome }: { outcome: EligibilityOutcome | null }) {
  const tone: TagTone = outcome === null ? 'neutral' : eligibilityTones[outcome];
  return <Tag tone={tone}>{outcome === null ? 'Not checked' : eligibilityOutcomes[outcome]}</Tag>;
}

/** What needs doing next, from what staff can see of a submission. */
export function nextStep({
  status,
  eligibility,
}: Pick<SubmissionSummary, 'status' | 'eligibility'>): string {
  if (status === 'withdrawn') return 'Nothing: the applicant withdrew it';
  if (eligibility === null) return 'Check eligibility';
  return eligibility === 'stopped' ? 'Check why it is not eligible' : 'Ready to move on';
}
