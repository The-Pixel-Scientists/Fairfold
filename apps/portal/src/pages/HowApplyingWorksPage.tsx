// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, PageHeading, buttonClassName } from '@pixelgrant/ui';

import { HOME_PATH } from '../paths.ts';
import { PageColumn } from '../PageColumn.tsx';

const steps = [
  {
    title: 'Check you can apply',
    text: 'Each grant will say who it is for. We will ask a few short questions first. That way you will not spend time on an application that is not right for you. If you cannot apply, we will tell you why.',
  },
  {
    title: 'Write your application',
    text: 'You will answer one set of questions at a time. We will save your answers as you go. You will be able to stop and come back before the closing date.',
  },
  {
    title: 'Check and send',
    text: 'Before you send your application, we will show you your answers and tell you if anything is missing. You will choose when to send it.',
  },
  {
    title: 'Wait for the decision',
    text: 'People at the funder will read your application and make the decision. You will see the result here only after the funder has released it.',
  },
];

/** What will happen when someone applies, in order. None of it is built yet, so the words are in the future tense. */
export default function HowApplyingWorksPage() {
  return (
    <PageColumn>
      <div className="flex flex-col gap-4">
        <PageHeading className="text-3xl">How applying works</PageHeading>
        <p className="max-w-prose text-lg text-ink">
          No grants are open yet, so you cannot apply today. This is how applying will work. Before
          you begin, each grant will tell you how long it takes and what you need to have ready.
        </p>
      </div>
      <ol className="flex flex-col gap-6">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="flex max-w-prose flex-col gap-2 rounded-lg border border-divider bg-surface p-gutter"
          >
            <h2 className="text-xl font-semibold text-ink">
              <span className="block text-sm font-medium text-muted">Step {index + 1}</span>
              {step.title}
            </h2>
            <p className="text-body text-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <div>
        <Link to={HOME_PATH} className={buttonClassName('secondary')}>
          Back to the home page
        </Link>
      </div>
    </PageColumn>
  );
}
