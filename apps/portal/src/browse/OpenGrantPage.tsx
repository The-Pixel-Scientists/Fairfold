// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One open round, for anyone, before signing in: `/open-grants/:roundId`.

import { getPublicRound } from '@pixel-scientists/grants/contracts';
import type { PublicRound } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName, useParams, useSession } from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../api.ts';
import { awardRange } from '../apply/format.ts';
import { Block } from '../apply/parts.tsx';
import { withQuery } from '../auth/redirects.ts';
import { PageIntro } from '../PageColumn.tsx';
import { homeCrumb } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';
import {
  OPEN_GRANTS_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  programmePath,
  startApplicationPath,
} from '../paths.ts';
import { useTenantSlug } from '../tenant.ts';
import { ukMoment } from './format.ts';
import { PublicRead } from './parts.tsx';

const crumbs = [homeCrumb, { label: 'Open grants', to: OPEN_GRANTS_PATH }];

function Dates({ round }: { round: PublicRound }) {
  return (
    <dl className="flex flex-col gap-4 border-y border-divider py-6">
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm font-medium text-muted">Opens</dt>
        <dd className="text-body text-ink">
          <time dateTime={round.opensAt}>{ukMoment(round.opensAt)}</time>
        </dd>
      </div>
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
  );
}

/** Sign in or sign up, which come back to the round once done; or, for someone signed in, start. */
function Actions({ roundId }: { roundId: string }) {
  const { state } = useSession();
  if (state.status === 'ready') {
    return (
      <div>
        <Link
          to={startApplicationPath(roundId)}
          className={buttonClassName('primary', 'w-full sm:w-auto')}
        >
          Start an application
        </Link>
      </div>
    );
  }
  const next = programmePath(roundId);
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link
        to={withQuery(SIGN_IN_PATH, next)}
        className={buttonClassName('primary', 'w-full sm:w-auto')}
      >
        Sign in to apply
      </Link>
      <Link
        to={withQuery(SIGN_UP_PATH, next)}
        className={buttonClassName('secondary', 'w-full sm:w-auto')}
      >
        Create an account
      </Link>
    </div>
  );
}

/** One open round, with who can apply, and the way on to applying. */
export default function OpenGrantPage() {
  const slug = useTenantSlug();
  const { roundId = '' } = useParams();
  const readRound = useCallback(
    () => callApi(getPublicRound, { params: { slug, roundId } }, { omitCredentials: true }),
    [slug, roundId],
  );
  const { read, retry } = useRead(readRound);
  return (
    <PublicRead title="Open grant" breadcrumbs={crumbs} read={read} retry={retry}>
      {(round) => (
        <>
          <PageIntro
            title={round.programme.title}
            breadcrumbs={[...crumbs, { label: round.title }]}
          >
            <p>{round.programme.summary}</p>
          </PageIntro>
          <Dates round={round} />
          {round.eligibility.length > 0 && (
            <Block title="Who can apply">
              <p className="max-w-prose text-body text-ink">
                You cannot apply if your answer to one of these questions stops you.
              </p>
              <ul role="list" className="flex flex-col gap-4">
                {round.eligibility.map((item) => (
                  <li key={item.label} className="flex flex-col gap-1">
                    <p className="font-semibold text-ink">{item.label}</p>
                    <p className="max-w-prose text-body text-muted">{item.explanation}</p>
                  </li>
                ))}
              </ul>
            </Block>
          )}
          <Actions roundId={round.id} />
        </>
      )}
    </PublicRead>
  );
}
