// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What was sent, read back as it was sent: every answer and file, against the
// form version the application was started on. It is the same for an
// application the applicant sent and one the funder sent for them.

import { visibleFields } from '@pixel-scientists/domain/forms';
import { AnswerView, Link, buttonClassName, useParams } from '@pixel-scientists/ui';

import { applicationPath } from '../paths.ts';
import { downloadHref } from './files.ts';
import { shownScreens, withFiles } from './form.ts';
import { helpers } from './helpers.ts';
import { ApplyPage, ApplyScreen } from './parts.tsx';
import type { View } from './parts.tsx';
import { useApplicationFilesRead } from './reads.ts';
import type { ApplicationWithFiles } from './reads.ts';
import { crumbs, loadingApplication, noApplication } from './views.tsx';

function sentView({ application, files }: ApplicationWithFiles): View {
  const { definition } = application.form;
  const heading = {
    title: 'What was sent',
    breadcrumbs: crumbs(application, 'What was sent'),
  };
  if (application.status === 'in_progress' || application.submittedAt === null) {
    return {
      heading: { ...heading, intro: <p>You have not sent this application yet.</p> },
      body: (
        <div>
          <Link
            to={applicationPath(application.id)}
            className={buttonClassName('primary', 'w-full sm:w-auto')}
          >
            Continue application
          </Link>
        </div>
      ),
    };
  }
  const answers = withFiles(definition, application.answers, files);
  return {
    heading: {
      ...heading,
      intro: <p>These are the answers and files that were sent. You cannot change them.</p>,
    },
    body: (
      <>
        <AnswerView
          sections={shownScreens(definition, answers)}
          visible={visibleFields(definition, answers)}
          answers={answers}
          helpers={helpers}
          files={files}
          hrefFor={(id) => downloadHref(application.id, id)}
          headingLevel="h2"
        />
        <div>
          <Link
            to={applicationPath(application.id)}
            className={buttonClassName('secondary', 'w-full sm:w-auto')}
          >
            Back to your application
          </Link>
        </div>
      </>
    ),
  };
}

function Sent() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationFilesRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={sentView}
    />
  );
}

/** What was sent: `/applications/:applicationId/sent`. */
export default function SentPage() {
  return (
    <ApplyScreen>
      <Sent />
    </ApplyScreen>
  );
}
