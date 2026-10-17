// SPDX-License-Identifier: AGPL-3.0-or-later

import { listOpenRounds } from '@pixel-scientists/grants/contracts';
import type { OpenRoundList } from '@pixel-scientists/grants/contracts';
import { EmptyState, Link, buttonClassName } from '@pixel-scientists/ui';

import { callApi } from '../api.ts';
import { ReadPage, homeCrumb } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';
import { programmePath } from '../paths.ts';
import { awardRange, closingTime } from './format.ts';
import { ApplyScreen } from './parts.tsx';

const TITLE = 'Programmes you can apply to';
const breadcrumbs = [homeCrumb, { label: TITLE }];

const readRounds = () => callApi(listOpenRounds, {});

function Programmes({ rounds }: OpenRoundList) {
  if (rounds.length === 0) {
    return (
      <EmptyState title="No programmes are open at the moment">
        <p>
          Check back later. When a programme opens for applications, it will appear on this page.
        </p>
      </EmptyState>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-4">
      {rounds.map((round) => (
        <li
          key={round.id}
          className="flex flex-col gap-5 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium text-muted">{round.title}</p>
            <h2 className="text-lg font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
              {round.programme.title}
            </h2>
            <p className="max-w-prose text-body text-ink">{round.programme.summary}</p>
          </div>
          <dl className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:gap-x-6">
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm font-medium text-muted">Applications close</dt>
              <dd className="text-body text-ink">
                <time dateTime={round.closesAt}>{closingTime(round.closesAt, round.timeZone)}</time>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-sm font-medium text-muted">You can ask for</dt>
              <dd className="text-body text-ink tabular-nums">
                {awardRange(round.awardMinimum, round.awardMaximum)}
              </dd>
            </div>
          </dl>
          <div className="border-t border-divider pt-4">
            <Link
              to={programmePath(round.id)}
              className={buttonClassName('secondary', 'w-full sm:w-auto')}
            >
              Read more and apply <span className="sr-only">for {round.programme.title}</span>
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function List() {
  const { read, retry } = useRead(readRounds);
  return (
    <ReadPage
      title={TITLE}
      breadcrumbs={breadcrumbs}
      intro={
        <p>These programmes are taking applications now. Choose one to read about it first.</p>
      }
      read={read}
      retry={retry}
    >
      {(list) => <Programmes {...list} />}
    </ReadPage>
  );
}

/** The programmes taking applications: `/programmes`. */
export default function ProgrammesPage() {
  return (
    <ApplyScreen>
      <List />
    </ApplyScreen>
  );
}
