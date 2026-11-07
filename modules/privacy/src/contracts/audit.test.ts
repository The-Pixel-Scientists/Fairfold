// SPDX-License-Identifier: AGPL-3.0-or-later

import { isAuditAction } from '@pixel-scientists/domain/platform';
import { expect, it } from 'vitest';

import { privacyAuditActions } from './audit.ts';

it('defines the privacy audit actions, with a sensitive read for each personal record', () => {
  for (const action of privacyAuditActions) expect(isAuditAction(action)).toBe(true);
  expect(privacyAuditActions).toEqual(
    expect.arrayContaining([
      'privacy.rights_request.created',
      'privacy.rights_request.updated',
      'privacy.rights_request.paused',
      'privacy.rights_request.resumed',
      'privacy.rights_request.extended',
      'privacy.rights_request.closed',
      'privacy.rights_request.viewed',
      'privacy.rights_request.export_started',
      'privacy.rights_request.export_viewed',
      'privacy.rights_request.erasure_started',
      'privacy.request_task.created',
      'privacy.request_task.completed',
      'privacy.breach.recorded',
      'privacy.breach.assessed',
      'privacy.breach.ico_notified',
      'privacy.breach.subjects_notified',
      'privacy.breach.viewed',
      'privacy.dpia.created',
      'privacy.dpia.signed_off',
      'privacy.dpia.viewed',
      'privacy.processing_activity.changed',
      'privacy.processor.changed',
      'privacy.consent_history.viewed',
    ]),
  );
});
