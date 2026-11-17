// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The messages between the applicant and the funder about one application,
// oldest first, with a reply form. A message shows only its side: "You" or
// "The funder", never the staff member who wrote it. Bodies are plain text.
// The thread is marked read only once it is on the screen.

import type { ApplicantMessage, ApplicantThread } from '@pixel-scientists/domain/notes';
import {
  getApplication,
  getApplicantThread,
  markApplicantThreadRead,
} from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, Tag, buttonClassName, useParams } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { callApi } from '../api.ts';
import { useRead } from '../party/useRead.ts';
import type { Read } from '../party/useRead.ts';
import { applicationPath } from '../paths.ts';
import { ukTimeOf } from './format.ts';
import { ReplyForm } from './ReplyForm.tsx';
import { ApplyPage, ApplyScreen, Block } from './parts.tsx';
import type { View } from './parts.tsx';
import { crumbs, loadingApplication, nameOf, noApplication } from './views.tsx';

interface Loaded {
  application: Application;
  thread: ApplicantThread;
}

const RETRY_MARK_READ_MS = 3000;

/**
 * Marks the messages read once they are shown, once per application even when
 * the page mounts twice. A failure is tried once more, quietly, and never
 * stops anyone reading.
 */
function useMarkRead(applicationId: string, unread: number): void {
  const marked = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (unread === 0 || marked.current === applicationId) return;
    marked.current = applicationId;
    const mark = () => callApi(markApplicantThreadRead, { params: { applicationId } });
    mark().catch(() => {
      timer.current = setTimeout(() => {
        void mark().catch(() => undefined);
      }, RETRY_MARK_READ_MS);
    });
  }, [applicationId, unread]);
}

function Message({ message }: { message: ApplicantMessage }) {
  const sender = message.side === 'applicant' ? 'You' : 'The funder';
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-divider bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-body font-semibold text-ink">{sender}</h3>
        <time dateTime={message.sentAt} className="text-sm text-muted">
          {ukTimeOf(message.sentAt)}
        </time>
        {message.unread && <Tag tone="info">New</Tag>}
      </div>
      <p className="max-w-prose whitespace-pre-line text-body text-ink [overflow-wrap:anywhere]">
        {message.body}
      </p>
    </li>
  );
}

function Thread({ application, thread }: Loaded) {
  const [added, setAdded] = useState<readonly ApplicantMessage[]>([]);
  useMarkRead(application.id, thread.unreadCount);
  const messages = [...thread.messages, ...added];

  return (
    <>
      <Block title="Messages">
        {messages.length === 0 ? (
          <p className="max-w-prose text-body text-ink">
            There are no messages yet. You can write to the funder below.
          </p>
        ) : (
          <ol role="list" className="flex flex-col gap-4">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
          </ol>
        )}
      </Block>
      <ReplyForm
        applicationId={application.id}
        onSent={(message) => {
          setAdded((current) => [...current, message]);
        }}
      />
      <div>
        <Link
          to={applicationPath(application.id)}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          Back to your application
        </Link>
      </div>
    </>
  );
}

const countWords = (count: number) =>
  `${String(count)} new ${count === 1 ? 'message' : 'messages'}`;

function view(loaded: Loaded): View {
  const { application, thread } = loaded;
  return {
    heading: {
      title: 'Messages',
      breadcrumbs: crumbs(application, 'Messages'),
      intro: (
        <p>
          About {nameOf(application)}.
          {thread.unreadCount > 0 && ` You have ${countWords(thread.unreadCount)}.`}
        </p>
      ),
    },
    body: <Thread {...loaded} />,
  };
}

function Messages() {
  const { applicationId = '' } = useParams();
  const read = useCallback(async (): Promise<Loaded> => {
    const params = { applicationId };
    const [application, thread] = await Promise.all([
      callApi(getApplication, { params }),
      callApi(getApplicantThread, { params }),
    ]);
    return { application, thread };
  }, [applicationId]);
  const { read: latest, retry } = useRead(read);
  // Keep the first answer: a second read after "mark read" would show nothing new.
  const [first, setFirst] = useState<Loaded>();
  if (latest.status === 'ready' && first?.application.id !== applicationId) {
    setFirst(latest.data);
  }
  const loaded: Read<Loaded> =
    latest.status === 'ready' && first?.application.id === applicationId
      ? { status: 'ready', data: first }
      : latest;
  return (
    <ApplyPage
      read={loaded}
      retry={retry}
      loading={{ ...loadingApplication, title: 'Messages' }}
      missing={noApplication}
      view={view}
    />
  );
}

/** The messages about one application: `/applications/:applicationId/messages`. */
export default function MessagesPage() {
  return (
    <ApplyScreen>
      <Messages />
    </ApplyScreen>
  );
}
