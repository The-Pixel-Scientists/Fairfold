// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  EmptyState,
  Link,
  PageHeader,
  WhenLoaded,
  asProblem,
  buttonClassName,
  useLoad,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { Gate } from '../Gate.tsx';
import { loadVisits } from '../loaders.ts';
import { NEW_VISIT_PATH, organisationLookupsPath, visitPath } from '../paths.ts';
import { formatDay, visitTypeWords } from '../words.ts';

type Page = Awaited<ReturnType<typeof loadVisits>>;

const first = () => loadVisits({});

/** Stacked items rather than a table, so the list reads in one column at any width. */
function List({ first: page }: { first: Page }) {
  const [visits, setVisits] = useState(page.visits);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [failed, setFailed] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  function more() {
    if (cursor === null) return;
    setFailed(null);
    loadVisits({ cursor }).then(
      (next) => {
        setVisits((current) => [...current, ...next.visits]);
        setCursor(next.nextCursor);
        setSaid(`Showing ${String(visits.length + next.visits.length)} visits.`);
      },
      (error: unknown) => {
        setFailed(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
      },
    );
  }

  if (visits.length === 0) {
    return (
      <EmptyState
        title="No visits recorded yet"
        action={
          <Link to={NEW_VISIT_PATH} className={buttonClassName('primary')}>
            Record a visit
          </Link>
        }
      >
        <p>Record a monitoring visit to keep its findings, attendees and follow-up together.</p>
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {visits.map((visit) => (
          <li
            key={visit.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-divider p-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <Link to={visitPath(visit.id)} className="font-medium">
                {`${formatDay(visit.visitedOn)}, ${visitTypeWords[visit.type].toLowerCase()}`}
              </Link>
              <Link to={organisationLookupsPath(visit.organisationId)} className="text-sm">
                Registry details for the organisation
              </Link>
            </div>
            <span className="text-muted">
              {visit.openFollowUps === 0
                ? 'No open follow-ups'
                : `${String(visit.openFollowUps)} open ${visit.openFollowUps === 1 ? 'follow-up' : 'follow-ups'}`}
            </span>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {said}
      </p>
      {failed !== null && (
        <p role="alert" className="text-danger">
          {failed}
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button onClick={more}>Show more visits</Button>
        </div>
      )}
    </>
  );
}

function Screen() {
  const { state, retry } = useLoad(first);
  return (
    <>
      <PageHeader
        title="Visits"
        description="Monitoring visits, newest first."
        actions={
          <Link to={NEW_VISIT_PATH} className={buttonClassName('primary')}>
            Record a visit
          </Link>
        }
      />
      <WhenLoaded state={state} label="Loading visits" retry={retry}>
        {(page) => <List first={page} />}
      </WhenLoaded>
    </>
  );
}

export default function VisitsPage() {
  return (
    <Gate permission="assure.visits.manage">
      <Screen />
    </Gate>
  );
}
