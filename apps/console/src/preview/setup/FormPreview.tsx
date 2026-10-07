// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Spring 2027 form as applicants see it, one section at a time, from the
// same data as the form builder. Answers are kept only until the page closes.

import {
  Button,
  Link,
  PageHeading,
  SectionProgress,
  Tag,
  buttonClassName,
  cx,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { formSections, sampleTotals } from './formData.ts';
import type { FormQuestion, Totals } from './formData.ts';
import { QuestionControl } from './QuestionPreview.tsx';
import type { Answers } from './QuestionPreview.tsx';
import { formPath } from './routes.ts';

/** What ‘Registered charity’ must be answered for a conditional question to show. */
const whenCharity = { 'charity-yes': 'yes', 'charity-no': 'no' } as const;

function isShown(question: FormQuestion, answers: Answers): boolean {
  return (
    question.condition === 'always' ||
    answers['charity-registered'] === whenCharity[question.condition]
  );
}

/** Walks through the form a section at a time. Every section stays on the page, so what was entered in one is there when you come back. */
export default function FormPreview() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [totals, setTotals] = useState<Totals>(sampleTotals);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [index]);

  const section = formSections[index];
  if (!section) return null;
  const last = index === formSections.length - 1;
  const go = (by: -1 | 1) => {
    moved.current = true;
    setIndex(index + by);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-stack">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-divider pb-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted">
          <Tag tone="info">Preview</Tag>
          <span>Nothing you enter here is saved.</span>
        </p>
        <Link to={formPath} className={buttonClassName('quiet')}>
          Back to the form builder
        </Link>
      </div>
      <p className="text-body text-muted">
        The Spring 2027 form as last published, as applicants see it. Questions that depend on an
        earlier answer appear when it applies. Changes you have not published are not shown.
      </p>
      <SectionProgress current={index + 1} total={formSections.length} />
      <div className="flex flex-col gap-1.5">
        <PageHeading ref={heading}>{section.title}</PageHeading>
        <p className="text-body text-muted">{section.introduction}</p>
      </div>
      {formSections.map((item, position) => (
        <div
          key={item.id}
          className={cx(position === index ? 'flex flex-col gap-stack' : 'hidden')}
        >
          {item.questions
            .filter((question) => isShown(question, answers))
            .map((question) => (
              <QuestionControl
                key={question.id}
                question={question}
                answers={answers}
                onAnswer={(id, answer) => {
                  setAnswers((current) => ({ ...current, [id]: answer }));
                }}
                totals={totals}
                onTotal={(id, total) => {
                  setTotals((current) => ({ ...current, [id]: total }));
                }}
              />
            ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 border-t border-divider pt-4">
        {index > 0 && (
          <Button
            onClick={() => {
              go(-1);
            }}
          >
            Previous section
          </Button>
        )}
        {last ? (
          <Link to={formPath} className={buttonClassName('primary')}>
            Back to the form builder
          </Link>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              go(1);
            }}
          >
            Next section
          </Button>
        )}
      </div>
    </div>
  );
}
