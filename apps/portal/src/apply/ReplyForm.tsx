// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reply to the funder. What the applicant types lives in this component
// only: never in storage, an address, a page title or a log. Leaving with
// words typed asks first. A press of "Send message" makes one message however
// often it is repeated, because a retry sends the same idempotency key.

import { ProblemError } from '@pixel-scientists/domain/api';
import { MAX_MESSAGE_LENGTH, messageBodySchema } from '@pixel-scientists/domain/notes';
import type { ApplicantMessage } from '@pixel-scientists/domain/notes';
import { sendApplicantMessage } from '@pixel-scientists/grants/contracts';
import { Button, ErrorSummary, FormField, Textarea, useLeaveGuard } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../api.ts';

const FIELD = 'message-body';
const limit = MAX_MESSAGE_LENGTH.toLocaleString('en-GB');
const tooLong = `Your message must be ${limit} characters or fewer. Shorten it, then send it again.`;
const notSent = 'Your message was not sent. Check your connection and select Send message again.';

/** What is wrong with a message, in words, or null when it can be sent. Only a first check: the server decides. */
function checkBody(text: string): string | null {
  if (text.trim().length > MAX_MESSAGE_LENGTH) return tooLong;
  const result = messageBodySchema.safeParse(text);
  return result.success ? null : (result.error.issues[0]?.message ?? notSent);
}

/** Said aloud, a little at a time, so a screen reader is not interrupted on every key press. */
function lengthNote(length: number): string {
  if (length > MAX_MESSAGE_LENGTH) return 'Your message is too long.';
  const left = MAX_MESSAGE_LENGTH - length;
  if (left <= 100) return 'Fewer than 100 characters left.';
  if (left <= 200) return 'Fewer than 200 characters left.';
  return '';
}

export function ReplyForm({
  applicationId,
  onSent,
}: {
  applicationId: string;
  onSent: (message: ApplicantMessage) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const key = useRef<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  useLeaveGuard(
    text.trim() !== '',
    'You have not sent your message. If you leave this page, it is thrown away.',
  );
  useEffect(() => {
    if (sent) status.current?.focus();
  }, [sent]);

  async function send() {
    if (pending) return;
    setAttempt((count) => count + 1);
    setSent(false);
    const mistake = checkBody(text);
    setProblem(mistake);
    if (mistake !== null) return;
    setPending(true);
    key.current ??= crypto.randomUUID();
    try {
      const message = await callApi(
        sendApplicantMessage,
        { params: { applicationId }, body: { body: text } },
        { idempotencyKey: key.current },
      );
      key.current = null;
      setText('');
      setSent(true);
      onSent(message);
    } catch (error) {
      const refused = error instanceof ProblemError && error.status >= 400 && error.status < 500;
      if (refused) key.current = null;
      setProblem(refused ? error.detail : notSent);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="flex flex-col gap-4"
    >
      {problem !== null && (
        <ErrorSummary key={attempt} errors={[{ fieldId: FIELD, message: problem }]} />
      )}
      <FormField
        id={FIELD}
        label="Send a message to the funder"
        hint={`Write up to ${limit} characters. We do not save your message until you send it.`}
        error={problem}
      >
        <Textarea
          rows={6}
          value={text}
          autoComplete="off"
          onChange={(event) => {
            key.current = null;
            setText(event.target.value);
          }}
        />
      </FormField>
      <p className="text-sm text-muted">
        {text.length.toLocaleString('en-GB')} of {limit} characters
      </p>
      <p role="status" className="sr-only">
        {lengthNote(text.length)}
      </p>
      <div>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={pending || undefined}
          className="w-full sm:w-auto"
        >
          Send message
        </Button>
      </div>
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        className="text-body font-medium text-ink empty:hidden"
      >
        {sent ? 'Message sent' : ''}
      </p>
    </form>
  );
}
