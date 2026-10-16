// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decision emails' checked lists (ADR 0020). The database checks the
// same values, so adding one is a contract change and a migration.

import { z } from 'zod';

/** Where a released decision's email stands, with the words the console shows. */
export const decisionEmailStatuses = {
  pending: 'Waiting to send',
  sent: 'Sent',
  failed: 'Not sent',
} as const;

export type DecisionEmailStatus = keyof typeof decisionEmailStatuses;

export const decisionEmailStatusSchema = z.enum(
  Object.keys(decisionEmailStatuses) as [DecisionEmailStatus, ...DecisionEmailStatus[]],
);

/**
 * Why an email was not sent, stored as `grants.decision_email.error_code`
 * and never with message text: the SMTP sender's failure codes (S02-16),
 * which the sender the API passes to grants must keep to, and `no_address`
 * when the recipient's person record has no email address.
 */
export const decisionEmailErrorCodes = [
  'invalid_message',
  'connection_failed',
  'tls_failed',
  'timeout',
  'auth_failed',
  'rejected',
  'recipient_refused',
  'failed',
  'no_address',
] as const;

export type DecisionEmailErrorCode = (typeof decisionEmailErrorCodes)[number];

export const decisionEmailErrorCodeSchema = z.enum(decisionEmailErrorCodes);
