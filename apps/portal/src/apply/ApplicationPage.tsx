// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The application as a task list: when it closes, that everything is saved,
// and each part with where it stands. Eligibility comes first, and the other
// sections wait for it.

import { checkEligibility } from '@pixel-scientists/domain/forms';
import {
  Link,
  Meter,
  SaveStatus,
  TaskList,
  buttonClassName,
  useParams,
} from '@pixel-scientists/ui';
import type { TaskItem } from '@pixel-scientists/ui';

import { checkPath, eligibilityPath, sectionPath } from '../paths.ts';
import { closingTime } from './format.ts';
import {
  ELIGIBILITY_SCREEN,
  problemsOf,
  questionsLeft,
  shownIds,
  shownScreens,
  statusOf,
  withFiles,
} from './form.ts';
import { ApplyPage, ApplyScreen, Block } from './parts.tsx';
import type { View } from './parts.tsx';
import { useApplicationFilesRead } from './reads.ts';
import type { ApplicationWithFiles } from './reads.ts';
import { crumbs, loadingApplication, noApplication, notDraft } from './views.tsx';

const questionsWord = (count: number) =>
  `${String(count)} ${count === 1 ? 'question' : 'questions'}`;

/** The task list: eligibility first, then the sections, which wait until the applicant can apply. */
function tasksOf({ application, files }: ApplicationWithFiles): TaskItem[] {
  const { definition } = application.form;
  const answers = withFiles(definition, application.answers, files);
  const shown = shownIds(definition, answers);
  const problems = problemsOf(definition, answers, 'submit');
  const eligibility = checkEligibility(definition, answers);

  return shownScreens(definition, answers).map((screen) => {
    const first = screen.id === ELIGIBILITY_SCREEN;
    const to = first ? eligibilityPath(application.id) : sectionPath(application.id, screen.id);
    if (!first && eligibility.status !== 'eligible') {
      return {
        label: screen.title,
        status: 'cannot-start',
        hint:
          eligibility.status === 'stopped'
            ? 'You cannot apply with your answers.'
            : 'Check you can apply first.',
      };
    }
    if (first && eligibility.status === 'stopped') {
      return {
        label: screen.title,
        to,
        status: 'in-progress',
        hint: 'Your answer means you cannot apply. You can change it.',
      };
    }
    const status = statusOf(screen, shown, answers, problems);
    const left = questionsLeft(screen, shown, problems);
    return {
      label: screen.title,
      to,
      status,
      ...(status === 'in-progress' && left > 0
        ? { hint: `${questionsWord(left)} to finish.` }
        : {}),
      ...(first && status === 'not-started'
        ? { hint: 'Answer these first, so you know you can apply.' }
        : {}),
    };
  });
}

function overviewView(loaded: ApplicationWithFiles): View {
  const { application } = loaded;
  if (application.status !== 'in_progress') return notDraft(application);
  const items = tasksOf(loaded);
  const completed = items.filter(({ status }) => status === 'completed').length;
  const next = items.find(({ to, status }) => to !== undefined && status !== 'completed');
  const { round } = application;

  return {
    heading: {
      title: 'Your application',
      breadcrumbs: crumbs(application),
      intro: (
        <>
          <p className="[overflow-wrap:anywhere]">
            This application is for {application.organisation.name}.
          </p>
          <p>Do one section at a time. You can leave and come back whenever you like.</p>
        </>
      ),
    },
    body: (
      <>
        <div className="grid gap-x-8 gap-y-5 border-y border-divider py-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted">Applications close</p>
            <p className="text-xl font-semibold tracking-tight text-ink">
              <time dateTime={round.closesAt}>{closingTime(round.closesAt, round.timeZone)}</time>
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted">Your answers</p>
            <SaveStatus
              state={{ status: 'saved', at: new Date(application.updatedAt) }}
              className="font-medium"
            />
            <p className="text-sm text-muted">We save as you type, so nothing is lost.</p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Meter
            label="Sections completed"
            value={completed}
            max={items.length}
            valueText={`${String(completed)} of ${String(items.length)}`}
          />
          <div>
            {next?.to === undefined ? (
              <Link
                to={checkPath(application.id)}
                className={buttonClassName('primary', 'w-full sm:w-auto')}
              >
                Check your answers
              </Link>
            ) : (
              <Link to={next.to} className={buttonClassName('primary', 'w-full sm:w-auto')}>
                Continue with {next.label}
              </Link>
            )}
          </div>
        </div>

        <Block title="Sections">
          <TaskList label="Application sections" items={items} />
        </Block>

        <Block title="When you have finished">
          <p className="max-w-prose text-body text-ink">
            You can read all your answers at any time. You can send your application once every
            section is complete.
          </p>
          {next?.to !== undefined && (
            <div>
              <Link
                to={checkPath(application.id)}
                className={buttonClassName('secondary', 'w-full sm:w-auto')}
              >
                Check your answers
              </Link>
            </div>
          )}
        </Block>
      </>
    ),
  };
}

function Overview() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationFilesRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={overviewView}
    />
  );
}

/** The application's front door: `/applications/:applicationId`. */
export default function ApplicationPage() {
  return (
    <ApplyScreen>
      <Overview />
    </ApplyScreen>
  );
}
