// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sending a test of an outcome email template (E9, ADR 0033). The request
// names a saved template version and nothing else: the email goes to the
// signed-in member's own address, read from the verified session, filled with
// the contract's made-up values through renderTemplate() and marked as a
// test. It is sent in the request, since the worker cannot read a staff
// address, and nothing is stored but the audit event. Each member sends at
// most TEST_SENDS_PER_HOUR an hour, counted from their own audit events.

import {
  renderTemplate,
  sampleMergeValues,
  TEST_SENDS_PER_HOUR,
  type Outcome,
  type TestSendInput,
} from '../../contracts/index.ts';
import type { MailSender } from '../decisions/context.ts';
import type { TriageArgs, TriageContext, TriageDependencies } from '../triage/context.ts';

const HOUR_MS = 3_600_000;
const NOT_SENT = 'The test email was not sent. Check the email settings and try again.';
const BROKEN = 'This template cannot be filled in. Edit it and save it again.';
export const TEST_SUBJECT_PREFIX = 'Test email: ';

export interface TemplateDependencies extends Pick<TriageDependencies, 'notFound' | 'refuse'> {
  readonly sender: MailSender;
  /** A 429 that says how many seconds to wait. */
  readonly slowDown: (retryAfterSeconds: number) => Error;
}

type Context = TriageContext & {
  readonly requestId: string;
  readonly session: { readonly email: () => Promise<string> };
};

type Tables = {
  'grants.email_template_version': { id: string; outcome: Outcome; subject: string; body: string };
  'app.audit_event': { action: string; actor_id: string | null; occurred_at: Date };
};

export function templateHandlers(deps: TemplateDependencies) {
  async function sendTestEmail({
    tx,
    context,
    input,
  }: Omit<TriageArgs<{ body: TestSendInput }>, 'context'> & {
    readonly context: Context;
  }): Promise<undefined> {
    const db = tx.$extendTables<Tables>();
    const template = await db
      .selectFrom('grants.email_template_version')
      .select(['outcome', 'subject', 'body'])
      .where('id', '=', input.body.templateVersionId)
      .executeTakeFirst();
    if (template === undefined) throw deps.notFound();

    const since = new Date(Date.now() - HOUR_MS);
    const recent = await db
      .selectFrom('app.audit_event')
      .select('occurred_at')
      .where('action', '=', 'grants.email_template.test_sent')
      .where('actor_id', '=', context.membership.id)
      .where('occurred_at', '>', since)
      .orderBy('occurred_at')
      .limit(TEST_SENDS_PER_HOUR)
      .execute();
    const oldest = recent[0];
    if (recent.length >= TEST_SENDS_PER_HOUR && oldest !== undefined) {
      throw deps.slowDown(
        Math.max(1, Math.ceil((oldest.occurred_at.getTime() + HOUR_MS - Date.now()) / 1000)),
      );
    }

    let rendered;
    try {
      rendered = renderTemplate(template, sampleMergeValues(template.outcome));
    } catch {
      throw deps.refuse(409, BROKEN);
    }
    await context.audit.record({
      action: 'grants.email_template.test_sent',
      entityId: input.body.templateVersionId,
    });
    const result = await deps.sender.send({
      to: await context.session.email(),
      subject: `${TEST_SUBJECT_PREFIX}${rendered.subject}`,
      text: rendered.body,
      requestId: context.requestId,
    });
    if (!result.sent) {
      throw deps.refuse(409, NOT_SENT, [{ field: 'delivery', message: result.code }]);
    }
    return undefined;
  }

  return { sendTestEmail };
}
