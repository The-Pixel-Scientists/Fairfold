// SPDX-License-Identifier: AGPL-3.0-or-later

import { getProfile, listMyOrganisations } from '@pixel-scientists/party/contracts';
import { Link, LoadingState, TaskList } from '@pixel-scientists/ui';
import type { TaskItem } from '@pixel-scientists/ui';
import { useId } from 'react';

import { callApi } from '../api.ts';
import { standaloneLink } from '../links.ts';
import { FUTURE_FUNDING_PATH, ORGANISATIONS_PATH, PROFILE_PATH } from '../paths.ts';
import { futureFundingChoice } from './consent.ts';
import { useRead } from './useRead.ts';

const tasks = [
  { label: 'Your details', to: PROFILE_PATH, hint: 'Your name and phone number.' },
  {
    label: 'Your organisations',
    to: ORGANISATIONS_PATH,
    hint: 'The charity or group you apply for.',
  },
  {
    label: 'Future funding',
    to: FUTURE_FUNDING_PATH,
    hint: 'Optional. Choose whether we can email you about new grants.',
  },
] as const;

const readProgress = () => Promise.all([callApi(getProfile, {}), callApi(listMyOrganisations, {})]);

/** What an applicant can do before a grant opens, and how far they have got. */
export function GetReady() {
  const { read } = useRead(readProgress);
  const titleId = useId();

  let list;
  if (read.status === 'ready') {
    const [profile, { organisations }] = read.data;
    const done = [
      profile.givenName !== null && profile.familyName !== null,
      organisations.length > 0,
      futureFundingChoice(profile) !== undefined,
    ];
    const items: TaskItem[] = tasks.map((task, index) => ({
      ...task,
      status: done[index] === true ? 'completed' : 'not-started',
    }));
    list = <TaskList label="Get ready to apply" items={items} />;
  } else if (read.status === 'loading') {
    list = <LoadingState label="Loading your progress" />;
  } else {
    list = (
      <>
        <p className="text-body text-ink">We could not check how far you have got.</p>
        <ul role="list" className="flex flex-col">
          {tasks.map(({ label, to }) => (
            <li key={to}>
              <Link to={to} className={standaloneLink}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <h2 id={titleId} className="text-xl font-semibold tracking-tight text-ink">
        Get ready to apply
      </h2>
      <p className="max-w-prose text-body text-ink">
        Add these before a grant opens. Each one takes a few minutes.
      </p>
      {list}
    </section>
  );
}
