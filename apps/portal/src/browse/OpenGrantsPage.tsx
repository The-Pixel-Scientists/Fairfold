// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's open rounds, for anyone, before signing in: `/open-grants`.

import { listPublicRounds } from '@pixel-scientists/grants/contracts';
import type { PublicRound } from '@pixel-scientists/grants/contracts';
import { EmptyState, Link, buttonClassName } from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { awardRange } from '../apply/format.ts';
import { callApi } from '../api.ts';
import { useTenantSlug } from '../tenant.ts';
import { PageIntro } from '../PageColumn.tsx';
import { useRead } from '../party/useRead.ts';
import { homeCrumb } from '../party/parts.tsx';
import { HOME_PATH, openGrantPath } from '../paths.ts';
import { ukMoment } from './format.ts';
import { PublicRead } from './parts.tsx';

const TITLE = 'Open grants';
const breadcrumbs = [homeCrumb, { label: TITLE }];

function Round({ round }: { round: PublicRound }) {
  return (
    <li className="flex flex-col gap-5 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-muted">{round.title}</p>
        <h2 className="text-lg font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
          {round.programme.title}
        </h2>
        <p className="max-w-prose text-body text-ink">{round.programme.summary}</p>
      </div>
      <dl className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:gap-x-6">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm font-medium text-muted">Closes</dt>
          <dd className="text-body text-ink">
            <time dateTime={round.closesAt}>{ukMoment(round.closesAt)}</time>
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
          to={openGrantPath(round.id)}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          Read more <span className="sr-only">about {round.programme.title}</span>
        </Link>
      </div>
    </li>
  );
}

/** The open rounds, in the order the API sends them. */
export default function OpenGrantsPage() {
  const slug = useTenantSlug();
  const readRounds = useCallback(
    () => callApi(listPublicRounds, { params: { slug } }, { anonymous: true }),
    [slug],
  );
  const { read, retry } = useRead(readRounds);
  return (
    <PublicRead title={TITLE} breadcrumbs={breadcrumbs} read={read} retry={retry}>
      {({ rounds }) => (
        <>
          <PageIntro title={TITLE} breadcrumbs={breadcrumbs}>
            <p>These grants are taking applications now. Choose one to read about it first.</p>
          </PageIntro>
          {rounds.length === 0 ? (
            <EmptyState
              title="There are no open grants at the moment"
              action={
                <Link to={HOME_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
                  Go to the start page
                </Link>
              }
            >
              <p>Check back later. When a grant opens for applications, it will appear here.</p>
            </EmptyState>
          ) : (
            <ul role="list" className="flex flex-col gap-4">
              {rounds.map((round) => (
                <Round key={round.id} round={round} />
              ))}
            </ul>
          )}
        </>
      )}
    </PublicRead>
  );
}
