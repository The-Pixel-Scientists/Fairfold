// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms a signed-in person has answered, newest first.

import { Button, EmptyState, Link, LoadingState, PageHeading } from '@pixel-scientists/ui';
import { useCallback, useState } from 'react';

import { listMyResponses } from '../contracts/index.ts';
import { dateOf } from './dates.ts';
import { useFormsHost } from './host.tsx';
import { LoadFailed } from './LoadFailed.tsx';
import { responsePath } from './paths.ts';
import { useLoad } from './useLoad.ts';

interface Summary {
  id: string;
  formTitle: string;
  submittedAt: string;
}

export default function MyResponsesPage() {
  const { call } = useFormsHost();
  const read = useCallback(() => call(listMyResponses, { query: {} }), [call]);
  const { load, retry } = useLoad(read, 'responses');
  const [more, setMore] = useState<readonly Summary[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  if (load.status === 'loading') return <LoadingState label="Loading your answers" />;
  if (load.status !== 'ready') return <LoadFailed retry={retry} />;

  const next = cursor === undefined ? load.data.nextCursor : cursor;
  const responses = [...load.data.responses, ...more];

  async function showMore() {
    if (next === null) return;
    setFailed(false);
    try {
      const page = await call(listMyResponses, { query: { cursor: next } });
      setMore((now) => [...now, ...page.responses]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4 sm:py-10">
      <PageHeading className="text-3xl sm:text-4xl">Your answers</PageHeading>
      {responses.length === 0 ? (
        <EmptyState title="You have not sent any answers yet">
          When you send answers to a form, you can read them here.
        </EmptyState>
      ) : (
        <ul role="list" className="flex flex-col gap-4">
          {responses.map((response) => (
            <li
              key={response.id}
              className="flex flex-col gap-1 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised)"
            >
              <Link
                to={responsePath(response.id)}
                className="min-h-target text-lg font-semibold [overflow-wrap:anywhere]"
              >
                {response.formTitle}
              </Link>
              <p className="text-body text-muted">Sent on {dateOf(response.submittedAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <div className="flex flex-col items-start gap-2">
          <Button
            onClick={() => {
              void showMore();
            }}
          >
            Show more
          </Button>
          {failed && (
            <p role="alert" className="text-body font-medium text-danger">
              We could not load more. Check your connection and try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
