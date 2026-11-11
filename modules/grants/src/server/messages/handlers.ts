// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Messages between an applicant and the funder about one application
// (ADR 0004, ADR 0030), matched with their contracts in apps/api/src/modules.ts.
// The side comes from the route and the author from the session, never from a
// request. The thread opens once the application is submitted, and another
// applicant's answers 404, not 403. Every view is built by the domain's
// projections, so the applicant never sees a staff name. Nothing here reads
// or changes a decision (rules 8 and 9). Sending as staff queues the email
// that says a message is waiting (send.ts); an applicant's message queues none.

import {
  projectMessage,
  projectThread,
  type ApplicantMessage,
  type ApplicantThread,
  type MessageSide,
  type StaffMessage,
  type StaffThread,
} from '@pixel-scientists/domain/notes';
import { personIdForUser } from '@pixel-scientists/party/server';

import type { SendMessageInput } from '../../contracts/index.ts';
import { submittedApplication } from '../notes/application.ts';
import type { NoteArgs } from '../notes/context.ts';
import type { Tx } from '../programme/tables.ts';
import type { MessageDependencies } from './context.ts';
import { queueNotification } from './send.ts';
import { ensureThread, threadOf } from './thread.ts';

type Mine = { params: { applicationId: string } };
type Submission = { params: { submissionId: string } };

export function messageHandlers(deps: MessageDependencies) {
  /** The caller's own submitted application and their person, or no record. */
  async function own(args: NoteArgs<Mine>, lock = false) {
    const { tx, context, input } = args;
    const personId = await personIdForUser(tx, context.session.userId);
    const application =
      personId === null
        ? undefined
        : await submittedApplication(tx, input.params.applicationId, {
            applicantPersonId: personId,
            lock,
          });
    if (application === undefined || personId === null) throw deps.notFound();
    return { application, personId };
  }

  async function staffApplication(tx: Tx, submissionId: string, lock = false) {
    const application = await submittedApplication(tx, submissionId, { lock });
    if (application === undefined) throw deps.notFound();
    return application;
  }

  /** Writes a message and records it; answers the message and its thread as they now stand. */
  async function write(
    args: NoteArgs<unknown>,
    applicationId: string,
    message: { side: MessageSide; body: string; authorId: string },
  ) {
    const { tx, context } = args;
    const threadId = await ensureThread(tx, deps.notes, applicationId);
    const id = await deps.notes.addMessage(tx, { threadId, ...message });
    await context.audit.record({
      action: 'grants.application.message_sent',
      entityId: applicationId,
      changes: { 'app.message.id': { after: id }, 'app.message.side': { after: message.side } },
    });
    const thread = await deps.notes.readThread(tx, threadId);
    const record = thread.messages.find((m) => m.id === id);
    if (record === undefined) throw new Error('The message just written was not found.');
    return { record, thread };
  }

  async function markRead(tx: Tx, applicationId: string, side: MessageSide): Promise<void> {
    const threadId = await threadOf(tx, applicationId);
    if (threadId !== undefined) await deps.notes.markRead(tx, threadId, side);
  }

  async function getApplicantThread(args: NoteArgs<Mine>): Promise<ApplicantThread> {
    const { application } = await own(args);
    const threadId = await threadOf(args.tx, application.id);
    return threadId === undefined
      ? { messages: [], unreadCount: 0 }
      : projectThread(await deps.notes.readThread(args.tx, threadId), 'applicant');
  }

  async function sendApplicantMessage(
    args: NoteArgs<Mine & { body: SendMessageInput }>,
  ): Promise<ApplicantMessage> {
    const { application, personId } = await own(args, true);
    const { record, thread } = await write(args, application.id, {
      side: 'applicant',
      body: args.input.body.body,
      authorId: personId,
    });
    return projectMessage(record, 'applicant', thread.applicantReadAt);
  }

  async function markApplicantThreadRead(args: NoteArgs<Mine>): Promise<undefined> {
    const { application } = await own(args);
    await markRead(args.tx, application.id, 'applicant');
  }

  async function getStaffThread({
    tx,
    context,
    input,
  }: NoteArgs<Submission>): Promise<StaffThread> {
    const application = await staffApplication(tx, input.params.submissionId);
    await context.audit.read({
      action: 'grants.application.messages_viewed',
      entityId: application.id,
    });
    const threadId = await threadOf(tx, application.id);
    return threadId === undefined
      ? { messages: [], unreadCount: 0 }
      : projectThread(await deps.notes.readThread(tx, threadId), 'staff');
  }

  async function sendStaffMessage(
    args: NoteArgs<Submission & { body: SendMessageInput }>,
  ): Promise<StaffMessage> {
    const { tx, context, input } = args;
    const application = await staffApplication(tx, input.params.submissionId, true);
    const { record, thread } = await write(args, application.id, {
      side: 'staff',
      body: input.body.body,
      authorId: context.membership.id,
    });
    await queueNotification(tx, deps, context, {
      messageId: record.id,
      applicationId: application.id,
      recipientPersonId: application.applicantPersonId,
    });
    return projectMessage(record, 'staff', thread.staffReadAt);
  }

  async function markStaffThreadRead({ tx, input }: NoteArgs<Submission>): Promise<undefined> {
    const application = await staffApplication(tx, input.params.submissionId);
    await markRead(tx, application.id, 'staff');
  }

  return {
    getApplicantThread,
    sendApplicantMessage,
    markApplicantThreadRead,
    getStaffThread,
    sendStaffMessage,
    markStaffThreadRead,
  };
}
