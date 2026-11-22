// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The signature queues migration 0102 registers (ADR 0009). Each holds one
// request id and nothing else: the tenant comes from the sending
// transaction, and everything else is read again when the job runs. Both are
// `exclusive`, so one job per request waits at a time.

import { defineQueue } from '@pixel-scientists/db/jobs';
import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

const payload = z.strictObject({ signature: idSchema });

export const signatureSendQueue = defineQueue('platform.signature_send', 'tenant', payload);
export const signatureRefreshQueue = defineQueue('platform.signature_refresh', 'tenant', payload);
