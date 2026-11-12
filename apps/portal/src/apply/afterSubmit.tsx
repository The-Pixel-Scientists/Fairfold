// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an applicant is offered once an application is sent: a calm note when the
// funder sent it for them, a way to read back what was sent, and the optional
// equality monitoring step. Nothing here is drawn for a draft.

import { getMonitoringForm, getMonitoringResponse } from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName } from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { callApi } from '../api.ts';
import { monitoringPath, sentPath } from '../paths.ts';
import { ukTimeOf } from './format.ts';
import { Block } from './parts.tsx';
import { useRead } from '../party/useRead.ts';

/** Says so when the funder sent the application, and when. It never says who. */
export function AssistedPanel({ application }: { application: Application }) {
  if (application.submissionRoute !== 'assisted' || application.submittedAt === null) return null;
  return (
    <section
      aria-labelledby="sent-for-you"
      className="flex max-w-prose flex-col gap-3 rounded-lg border border-divider bg-info-soft p-5"
    >
      <h2 id="sent-for-you" className="text-lg font-semibold text-ink">
        The funder sent this application for you
      </h2>
      <p className="text-body text-ink">
        It was sent on {ukTimeOf(application.submittedAt)}. You can read exactly what was sent.
      </p>
      <div>
        <Link
          to={sentPath(application.id)}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          See what was sent
        </Link>
      </div>
    </section>
  );
}

/**
 * The offer of the monitoring questions, when the round has any. The questions
 * are optional, so a page that cannot read them says nothing about them.
 */
export function MonitoringOffer({ application }: { application: Application }) {
  const { id } = application;
  const read = useCallback(async () => {
    try {
      const params = { applicationId: id };
      const [, mine] = await Promise.all([
        callApi(getMonitoringForm, { params }),
        callApi(getMonitoringResponse, { params }),
      ]);
      return { answered: mine.response !== null };
    } catch {
      return null;
    }
  }, [id]);
  const { read: offer } = useRead(read);
  if (offer.status !== 'ready' || offer.data === null) return null;

  return (
    <Block title="Equality monitoring">
      <p className="max-w-prose text-body text-ink">
        {offer.data.answered
          ? 'You answered the equality monitoring questions. You can read your answers, or withdraw them.'
          : 'You can answer a few optional questions. They help the funder count who applies. They have no effect on your application.'}
      </p>
      <div>
        <Link to={monitoringPath(id)} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
          {offer.data.answered ? 'See my answers' : 'Answer monitoring questions'}
        </Link>
      </div>
    </Block>
  );
}
