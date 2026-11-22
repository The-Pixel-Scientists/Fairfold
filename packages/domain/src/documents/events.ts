// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signature request's status changes, published through the outbox
// (ADR 0034) when the worker moves a request. Each carries the request's id
// and status only: the module that asked for the signature finds its own
// record through its link table (ADR 0016) and acts in its own handler. A
// declined, expired or failed request never changes an award or
// application on its own (rule 9).
//
// Decided: these are read with `platform.audit.read` until the agreements
// tool adds a permission of its own, since the audit log already shows the
// same ids and statuses.

import { z } from 'zod';

import { defineEvent } from '../events/define.ts';
import { idSchema } from '../id.ts';
import type { SignatureStatus } from './esign.ts';

type Published = Exclude<SignatureStatus, 'draft'>;

function statusEvent<const S extends Published>(status: S) {
  return defineEvent(`platform.signature_request_${status}.v1`, {
    read: 'platform.audit.read',
    data: z.strictObject({
      signatureRequestId: idSchema,
      status: z.literal(status),
      changedAt: z.iso.datetime({ offset: true }),
    }),
  });
}

export const signatureEvents = {
  sent: statusEvent('sent'),
  viewed: statusEvent('viewed'),
  signed: statusEvent('signed'),
  declined: statusEvent('declined'),
  expired: statusEvent('expired'),
  cancelled: statusEvent('cancelled'),
  failed: statusEvent('failed'),
} as const satisfies Record<Published, unknown>;
