// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName, useParams } from '@pixel-scientists/ui';

import { applicationPath } from '../paths.ts';
import { ELIGIBILITY_SCREEN, screensOf } from './form.ts';
import { ApplyPage, ApplyScreen } from './parts.tsx';
import type { View } from './parts.tsx';
import { QuestionsScreen } from './QuestionsScreen.tsx';
import { useApplicationRead } from './reads.ts';
import { crumbs, loadingApplication, noApplication, notDraft } from './views.tsx';

function eligibilityView(application: Application, reload: () => void): View {
  if (application.status !== 'in_progress') return notDraft(application);
  const screen = screensOf(application.form.definition).find(({ id }) => id === ELIGIBILITY_SCREEN);
  if (screen === undefined) {
    return {
      heading: {
        title: 'Check you can apply',
        breadcrumbs: crumbs(application, 'Check you can apply'),
        intro: <p>This programme has no questions to check first.</p>,
      },
      body: (
        <div>
          <Link
            to={applicationPath(application.id)}
            className={buttonClassName('primary', 'w-full sm:w-auto')}
          >
            Go to your application
          </Link>
        </div>
      ),
    };
  }
  return { body: <QuestionsScreen application={application} screen={screen} reload={reload} /> };
}

function Eligibility() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={(application) => eligibilityView(application, retry)}
    />
  );
}

/** The questions that decide whether the applicant can apply, before the rest: `/applications/:applicationId/eligibility`. */
export default function EligibilityPage() {
  return (
    <ApplyScreen>
      <Eligibility />
    </ApplyScreen>
  );
}
