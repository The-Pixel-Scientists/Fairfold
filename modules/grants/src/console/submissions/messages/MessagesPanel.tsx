// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StaffMessage, StaffThread } from '@pixel-scientists/domain/notes';
import { Button, LoadingState, Panel, Tag, useLoad } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatMoment } from '../../programme/format.ts';
import { Body } from '../notes/Body.tsx';
import { ComposeForm } from '../notes/ComposeForm.tsx';
import { checkMessage, MAX_MESSAGE_LENGTH, nameOf } from '../notes/words.ts';
import { loadThread, markRead, postMessage } from './loaders.ts';

const unreadWords = (count: number) =>
  count === 0 ? 'No unread messages' : `${String(count)} unread message${count === 1 ? '' : 's'}`;

const cleared = (thread: StaffThread): StaffThread => ({
  messages: thread.messages.map((message) => ({ ...message, unread: false })),
  unreadCount: 0,
});

function Message({
  message,
  isNew,
  focused,
}: {
  message: StaffMessage;
  isNew: boolean;
  focused: boolean;
}) {
  const element = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) element.current?.focus();
  }, [focused]);
  const funder = message.side === 'staff';
  return (
    <li
      ref={element}
      tabIndex={-1}
      className="flex flex-col gap-1 border-t border-divider pt-3 first:border-t-0 first:pt-0"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-medium text-ink">
          {funder ? `From the funder: ${nameOf(message.authorName)}` : 'From the applicant'}
        </span>
        <span>{formatMoment(message.sentAt)}</span>
        {message.unread && <Tag tone="info">Unread</Tag>}
        {isNew && <Tag tone="warning">New</Tag>}
      </p>
      <Body text={message.body} />
    </li>
  );
}

function Thread({ submissionId, initial }: { submissionId: string; initial: StaffThread }) {
  const [thread, setThread] = useState(initial);
  const [firstNew, setFirstNew] = useState(() => initial.messages.find((m) => m.unread)?.id);
  const [sent, setSent] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [checking, setChecking] = useState(false);

  /** A separate call, made once the thread is on screen; the applicant's side is untouched. */
  const markAsRead = useCallback(() => {
    void markRead(submissionId).then(
      () => {
        setThread(cleared);
      },
      () => undefined,
    );
  }, [submissionId]);

  useEffect(() => {
    if (initial.unreadCount > 0) markAsRead();
  }, [initial, markAsRead]);

  const check = () => {
    setChecking(true);
    loadThread(submissionId)
      .then((next) => {
        setThread(next);
        setFirstNew(next.messages.find((m) => m.unread)?.id);
        if (next.unreadCount > 0) markAsRead();
        setSaid(next.unreadCount === 0 ? 'No new messages' : 'New messages loaded');
      })
      .catch(() => {
        setSaid('The messages did not load. Try again.');
      })
      .finally(() => {
        setChecking(false);
      });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body font-medium text-ink">{unreadWords(thread.unreadCount)}</p>
        <Button disabled={checking} onClick={check}>
          Check for new messages
        </Button>
      </div>
      {thread.messages.length === 0 ? (
        <p className="text-body text-muted">
          No messages have been sent. Write one below to start the conversation.
        </p>
      ) : (
        <ol aria-label="Messages, oldest first" className="flex flex-col gap-3">
          {thread.messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              isNew={message.id === firstNew}
              focused={message.id === sent}
            />
          ))}
        </ol>
      )}
      <ComposeForm
        label="Send message to applicant"
        hint="The applicant is emailed that a message is waiting, without the message text. Decisions are released separately."
        submitLabel="Send message to applicant"
        max={MAX_MESSAGE_LENGTH}
        check={checkMessage}
        send={async (text, key) => {
          const message = await postMessage(submissionId, text, key);
          setThread((was) => ({ ...was, messages: [...was.messages, message] }));
          setSent(message.id);
          setSaid('Message sent');
        }}
      />
      <p role="status" className="sr-only">
        {said}
      </p>
    </>
  );
}

/**
 * The application's one message thread. Mount it only when the member opens
 * the section: reading a thread is an audited read, so it is never fetched
 * ahead of time.
 */
export function MessagesPanel({ submissionId }: { submissionId: string }) {
  const { state, retry } = useLoad(loadThread, submissionId);
  return (
    <Panel title="Messages">
      {state.status === 'loading' && <LoadingState label="Loading messages" />}
      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-danger">{state.message}</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && <Thread submissionId={submissionId} initial={state.value} />}
    </Panel>
  );
}
