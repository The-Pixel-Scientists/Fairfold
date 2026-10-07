// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TagTone } from '@pixel-scientists/ui';

import type { ApplicationStatus } from '../story.ts';

/** The Tag tone for an application's status, as the design brief sets them. */
export const applicationTone: Readonly<Record<ApplicationStatus, TagTone>> = {
  Submitted: 'info',
  Ineligible: 'danger',
  'In review': 'info',
  Shortlisted: 'info',
  Awarded: 'success',
  Waitlisted: 'warning',
  Declined: 'danger',
};
