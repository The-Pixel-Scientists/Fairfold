// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages between an applicant and the funder about one application
// (ADR 0004, ADR 0030): a platform thread that grants links through
// `grants.application_message` (S12-13), one per application, created with
// its first message.
//
// The rules:
// - the applicant reads, writes to and marks read the thread on their own
//   applications, under `grants.applications.apply` and `own_application`;
//   members with `grants.applications.read` do the same as the funder,
//   anywhere in the tenant. The thread opens once the application is
//   submitted: on a draft both sides answer 404, since staff never see a
//   draft, and so does anyone else's application;
// - the side comes from the route's audience and the author from the
//   session (rule 6); no body names either;
// - unread state is per side: each side has its own last-read time, set by
//   the database when that side marks the thread read, and each response
//   counts unread messages for the caller's side only;
// - the applicant sees funder messages as from the funder, never the
//   member's name or id; projectThread() and projectMessage() build each
//   audience's view;
// - no reviewer route exists: a message can name the applicant;
// - a funder message is free text a person writes. It carries nothing from a
//   decision, and releasing one stays its own named action (rule 8);
// - sending records `grants.application.message_sent`, and each staff read
//   of a thread `grants.application.messages_viewed`, a sensitive read
//   (rule 4). Both are recorded against the application id, so their subject
//   is the applicant (ADR 0027); the message id and side, or the number of
//   messages read, go in the changes. Never a body or a name;
// - a funder message tells the applicant by a transactional email
//   (ADR 0033) that a message is waiting, with no message text. The job's
//   payload is an outbox row id, so no event or payload ever holds text.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  applicantMessageSchema,
  applicantThreadSchema,
  messageBodySchema,
  staffMessageSchema,
  staffThreadSchema,
} from '@pixel-scientists/domain/notes';
import { z } from 'zod';

const mine = {
  audience: 'portal',
  module: 'grants',
  permission: 'grants.applications.apply',
  scope: 'own_application',
} as const;

const staff = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.read',
  scope: 'tenant',
} as const;

const application = z.strictObject({ applicationId: idSchema });

const submission = z.strictObject({ submissionId: idSchema });

export const sendMessageInputSchema = z.strictObject({ body: messageBodySchema });

export type SendMessageInput = z.input<typeof sendMessageInputSchema>;

export const getApplicantThread = defineRoute({
  ...mine,
  method: 'GET',
  path: '/portal/applications/:applicationId/messages',
  summary: "Read the messages on one of the caller's applications",
  params: application,
  responses: { 200: applicantThreadSchema },
});

export const sendApplicantMessage = defineRoute({
  ...mine,
  method: 'POST',
  idempotent: true,
  path: '/portal/applications/:applicationId/messages',
  summary: "Send the funder a message about one of the caller's applications",
  params: application,
  body: sendMessageInputSchema,
  responses: { 201: applicantMessageSchema },
});

export const markApplicantThreadRead = defineRoute({
  ...mine,
  method: 'POST',
  path: '/portal/applications/:applicationId/messages/read',
  summary: "Mark the messages on one of the caller's applications as read on the applicant's side",
  params: application,
  responses: { 204: null },
});

export const getStaffThread = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/submissions/:submissionId/messages',
  summary: 'Read the messages on a submission, recording the read',
  params: submission,
  responses: { 200: staffThreadSchema },
});

export const sendStaffMessage = defineRoute({
  ...staff,
  method: 'POST',
  idempotent: true,
  path: '/console/submissions/:submissionId/messages',
  summary: 'Send the applicant a message about a submission, as the funder',
  params: submission,
  body: sendMessageInputSchema,
  responses: { 201: staffMessageSchema },
});

export const markStaffThreadRead = defineRoute({
  ...staff,
  method: 'POST',
  path: '/console/submissions/:submissionId/messages/read',
  summary: "Mark the messages on a submission as read on the funder's side",
  params: submission,
  responses: { 204: null },
});

export const messageRoutes = {
  getApplicantThread,
  sendApplicantMessage,
  markApplicantThreadRead,
  getStaffThread,
  sendStaffMessage,
  markStaffThreadRead,
} as const;
