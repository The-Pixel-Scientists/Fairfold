// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's front page. It answers "is this for me?" before the applicant
// spends any time: what the fund is for, who it cannot help, how much, when it
// closes, and what to have ready.

import { getOpenRound } from '@pixel-scientists/grants/contracts';
import type { OpenRoundDetail } from '@pixel-scientists/grants/contracts';
import { Link, Tag, buttonClassName, useParams, useSession } from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../api.ts';
import { homeCrumb } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';
import { PROGRAMMES_PATH, startApplicationPath } from '../paths.ts';
import { awardRange, closingTime } from './format.ts';
import { minutesToAnswer, needsOf, stopsOf, timeWords } from './form.ts';
import { ApplyPage, ApplyScreen, Block, PageTitle, Paragraphs } from './parts.tsx';
import type { View } from './parts.tsx';

const programmes = { label: 'Programmes you can apply to', to: PROGRAMMES_PATH };

function roundView(round: OpenRoundDetail, email: string | null): View {
  const { definition } = round.form;
  const stops = stopsOf(definition);
  const needs = needsOf(definition);

  return {
    heading: {
      title: round.programme.title,
      breadcrumbs: [homeCrumb, programmes, { label: round.programme.title }],
      intro: <p>{round.programme.summary}</p>,
    },
    body: (
      <>
        <PageTitle title={round.programme.title} />
        <div className="flex flex-col gap-1.5 border-y border-divider py-6">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-muted">
            <Tag tone="info">Open</Tag>
            {round.title}: applications close
          </p>
          <p className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            <time dateTime={round.closesAt}>{closingTime(round.closesAt, round.timeZone)}</time>
          </p>
          <p className="max-w-prose text-body text-muted">
            You can start now, stop whenever you like and come back before then.
          </p>
        </div>

        {round.programme.description.trim() !== '' && (
          <Block title="What the fund is for">
            <Paragraphs text={round.programme.description} />
          </Block>
        )}

        <Block title="How much you can ask for">
          <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
            {awardRange(round.awardMinimum, round.awardMaximum)}
          </p>
        </Block>

        {stops.length > 0 && (
          <Block title="Who can apply">
            <p className="max-w-prose text-body text-ink">
              We ask a few short questions first. If you cannot apply, we tell you why before you
              write anything else. For example:
            </p>
            <ul role="list" className="flex list-disc flex-col gap-2 pl-5">
              {stops.map((stop) => (
                <li key={stop} className="max-w-prose text-body text-ink">
                  {stop}
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block title="Before you start">
          <p className="max-w-prose text-body text-ink">
            It takes {timeWords(minutesToAnswer(definition))}. We save your answers as you go, so
            you can stop and come back whenever you need to.
          </p>
          {needs.length > 0 && (
            <>
              <p className="max-w-prose text-body text-ink">Have these ready:</p>
              <ul role="list" className="divide-y divide-divider border-y border-divider">
                {needs.map((need) => (
                  <li key={need.title} className="flex flex-col py-3">
                    <p className="font-semibold text-ink">{need.title}</p>
                    <p className="text-body text-muted">{need.text}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Block>

        <div className="flex flex-col gap-4">
          <div>
            <Link
              to={startApplicationPath(round.id)}
              className={buttonClassName('primary', 'w-full sm:w-auto')}
            >
              Start application
            </Link>
          </div>
          {email !== null && (
            <p className="max-w-prose text-body text-muted">
              We save your answers to your account, {email}.
            </p>
          )}
        </div>
      </>
    ),
  };
}

function Round() {
  const { roundId = '' } = useParams();
  const { state } = useSession();
  const email = state.status === 'ready' ? state.session.user.email : null;
  const read = useCallback(() => callApi(getOpenRound, { params: { roundId } }), [roundId]);
  const { read: round, retry } = useRead(read);
  return (
    <ApplyPage
      read={round}
      retry={retry}
      loading={{ title: 'Programme', breadcrumbs: [homeCrumb, programmes] }}
      missing={{
        text: 'This programme is not taking applications. It may have closed.',
        to: PROGRAMMES_PATH,
        link: 'See programmes you can apply to',
      }}
      view={(detail) => roundView(detail, email)}
    />
  );
}

/** One programme's round: `/programmes/:roundId`. */
export default function RoundPage() {
  return (
    <ApplyScreen>
      <Round />
    </ApplyScreen>
  );
}
