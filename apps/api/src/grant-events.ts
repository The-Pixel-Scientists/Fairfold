// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the grants module publishes events (ADR 0016, ADR 0034): in the
// request's transaction, so the jobs commit or roll back with the change.
// The tenant comes from the transaction and the causing member from the
// session; publish() checks the payload against the event's schema.

import { publish, type JobSender } from '@pixel-scientists/db/jobs';
import type { EventDefinition } from '@pixel-scientists/domain/events';
import type { GrantsDependencies } from '@pixel-scientists/grants/server';

export function publishGrantsEvent(sender: JobSender): GrantsDependencies['publish'] {
  return (tx, event, data, { requestId, membershipId }) =>
    publish(tx, event as EventDefinition, data, {
      sender,
      requestId,
      causingUserId: membershipId,
      causedBy: membershipId,
    });
}
