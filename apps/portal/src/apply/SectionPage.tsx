// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkEligibility } from '@pixel-scientists/domain/forms';
import { Link, buttonClassName, useParams } from '@pixel-scientists/ui';

import { applicationPath, eligibilityPath } from '../paths.ts';
import { ELIGIBILITY_SCREEN, screensOf } from './form.ts';
import { ApplyPage, ApplyScreen } from './parts.tsx';
import type { View } from './parts.tsx';
import { QuestionsScreen } from './QuestionsScreen.tsx';
import { useApplicationFilesRead } from './reads.ts';
import type { ApplicationWithFiles } from './reads.ts';
import { crumbs, loadingApplication, noApplication, notDraft } from './views.tsx';

function sectionView(
  { application, files }: ApplicationWithFiles,
  sectionId: string,
  reload: () => void,
): View {
  if (application.status !== 'in_progress') return notDraft(application);
  const { definition } = application.form;
  const screen = screensOf(definition).find(({ id }) => id === sectionId);
  if (screen === undefined || screen.id === ELIGIBILITY_SCREEN) {
    return {
      heading: {
        title: 'We cannot find this section',
        breadcrumbs: crumbs(application, 'Section not found'),
        intro: <p>This section is not part of your application.</p>,
      },
      body: (
        <div>
          <Link
            to={applicationPath(application.id)}
            className={buttonClassName('secondary', 'w-full sm:w-auto')}
          >
            Go to your application
          </Link>
        </div>
      ),
    };
  }
  if (checkEligibility(definition, application.answers).status !== 'eligible') {
    return {
      heading: {
        title: screen.title,
        breadcrumbs: crumbs(application, screen.title),
        intro: <p>Check you can apply before you start this section.</p>,
      },
      body: (
        <div>
          <Link
            to={eligibilityPath(application.id)}
            className={buttonClassName('primary', 'w-full sm:w-auto')}
          >
            Check you can apply
          </Link>
        </div>
      ),
    };
  }
  return {
    body: (
      <QuestionsScreen
        key={screen.id}
        application={application}
        screen={screen}
        files={files}
        reload={reload}
      />
    ),
  };
}

function Section() {
  const { applicationId = '', sectionId = '' } = useParams();
  const { read, retry } = useApplicationFilesRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={(loaded) => sectionView(loaded, sectionId, retry)}
    />
  );
}

/** One section of the form, on a screen of its own: `/applications/:applicationId/sections/:sectionId`. */
export default function SectionPage() {
  return (
    <ApplyScreen>
      <Section />
    </ApplyScreen>
  );
}
