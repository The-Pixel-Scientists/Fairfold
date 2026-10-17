// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's status as the applicant reads it, the same on every page.
// The words come from the contract, so the list, the application and the
// outcome never disagree.

import { applicantStatuses } from '@pixel-scientists/grants/contracts';
import type { ApplicantStatus } from '@pixel-scientists/grants/contracts';
import { Tag } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';

const tones: Record<ApplicantStatus, TagTone> = {
  in_progress: 'info',
  submitted: 'info',
  under_review: 'info',
  awarded: 'success',
  waitlisted: 'warning',
  not_funded: 'neutral',
  withdrawn: 'neutral',
};

export function StatusTag({ status }: { status: ApplicantStatus }) {
  return <Tag tone={tones[status]}>{applicantStatuses[status]}</Tag>;
}
