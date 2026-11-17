// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The jobs the worker takes from the modules (ADR 0009, ADR 0016). The grants
// release email, message notification and reminder jobs send through the mail server the worker is given.

import { partyErasureTarget } from '@pixel-scientists/party/server';

import { releaseEmailJob } from '../decision-emails.ts';
import { messageNotificationJob } from '../message-notifications.ts';
import { reminderScanJob, reminderSendJob } from '../reminders.ts';
import { erasureJob } from '../platform/erasure/index.ts';
import { collectModuleJobs, erasureContributions, type Mail } from '../modules.ts';
import type { ModuleJob } from './registry.ts';

export function workerModuleJobs(mail: Mail): readonly ModuleJob[] {
  return collectModuleJobs([
    {
      jobs: [
        releaseEmailJob(mail),
        messageNotificationJob(mail),
        reminderScanJob(),
        reminderSendJob(mail),
        erasureJob({ contributions: erasureContributions, target: partyErasureTarget }),
      ],
    },
  ]);
}
