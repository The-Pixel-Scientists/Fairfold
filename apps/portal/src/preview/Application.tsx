// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the application as a task list: the deadline, that everything
// is saved, and the six sections with where each one stands.

import { Link, Meter, SaveStatus, TaskList, buttonClassName } from '@pixel-scientists/ui';
import type { TaskItem } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';
import { savedAt } from './journey.ts';
import { ScreenHeader, Section } from './parts.tsx';
import { round, sections } from './story.ts';

const status: Record<(typeof sections)[number]['id'], Pick<TaskItem, 'status' | 'hint' | 'to'>> = {
  organisation: {
    status: 'completed',
    hint: 'Who you are and how to reach you.',
    to: '/application/organisation',
  },
  project: {
    status: 'completed',
    hint: 'What you will do and who it will help.',
    to: '/application/project',
  },
  budget: {
    status: 'in-progress',
    hint: 'What it will cost. You have added 6\u00a0costs.',
    to: '/application/budget',
  },
  outcomes: {
    status: 'not-started',
    hint: 'What will change for people. About 10\u00a0minutes.',
    to: '/application/outcomes',
  },
  documents: {
    status: 'not-started',
    hint: 'Your accounts, constitution and safeguarding policy. About 10\u00a0minutes.',
    to: '/application/documents',
  },
  declarations: {
    status: 'cannot-start',
    hint: 'You confirm these on the check your answers page, once every other section is complete.',
  },
};

const items: readonly TaskItem[] = sections.map(({ id, title }) => ({
  label: title,
  ...status[id],
}));
const completed = items.filter((item) => item.status === 'completed').length;

/** The application's front door: what is done, what is next, and when it closes. */
export default function Application() {
  return (
    <PageColumn>
      <ScreenHeader
        title="Your application"
        breadcrumbs={[
          { label: 'Your applications', to: '/applications' },
          { label: `${round.programme}, ${round.name}` },
        ]}
      >
        <p>
          Do one section at a time, in any order. You can leave and come back whenever you like.
        </p>
      </ScreenHeader>

      <div className="grid gap-x-8 gap-y-5 border-y border-divider py-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted">Applications close</p>
          <p className="text-xl font-semibold tracking-tight text-ink">
            <time dateTime="2027-03-03T17:00">{round.closes}</time>
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted">Your answers</p>
          <SaveStatus state={{ status: 'saved', at: savedAt }} className="font-medium" />
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
          <Link to="/application/budget" className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Continue with Budget
          </Link>
        </div>
      </div>

      <Section title="Sections">
        <TaskList label="Application sections" items={items} />
      </Section>

      <Section title="When you have finished">
        <p className="max-w-prose text-body text-ink">
          You can read all your answers at any time. You can send your application once every
          section is complete.
        </p>
        <div>
          <Link
            to="/application/check"
            className={buttonClassName('secondary', 'w-full sm:w-auto')}
          >
            Check your answers
          </Link>
        </div>
      </Section>
    </PageColumn>
  );
}
