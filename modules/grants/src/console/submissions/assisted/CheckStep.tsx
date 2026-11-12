// SPDX-License-Identifier: AGPL-3.0-or-later

import { questionsOf } from '@pixel-scientists/domain/forms';
import type { Answers } from '@pixel-scientists/domain/forms';
import type { FieldProblem } from '@pixel-scientists/domain/platform';
import {
  Button,
  EligibilityStop,
  Panel,
  SummaryList,
  Tag,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { AssistedApplication } from '../../../contracts/index.ts';
import { useStepUp } from '../../decisions/useStepUp.tsx';
import { closingWords } from '../adjustments/words.ts';
import { controlId, progress, toFix } from './answers.ts';
import { checkAssisted, submitAssisted } from './loaders.ts';
import { problemsOf } from './problems.ts';

export interface CheckStepProps {
  application: AssistedApplication;
  /** What is on the screen, all of it saved: the page saves before it comes here. */
  answers: Answers;
  /** The answers version the save left, which the submission is based on. */
  version: number;
  /** Goes back to the answers, to the control when one is named. */
  onBack: (controlId?: string) => void;
  /** The server refused: the questions it names, and why. */
  onRefused: (list: FieldProblem[], text: string) => void;
  onSubmitted: () => void;
}

/** What will be sent and what is missing, before the member submits for the applicant. */
export function CheckStep({
  application,
  answers,
  version,
  onBack,
  onRefused,
  onSubmitted,
}: CheckStepProps) {
  const { definition } = application.form;
  const { name } = application.organisation;
  const stepUp = useStepUp();
  const eligibility = useLoad(checkAssisted, application.id);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const missing = toFix(definition, answers);
  const labels = new Map(questionsOf(definition).map(({ id, label }) => [id, label]));
  const [done, of] = progress(definition, answers);
  const stopped =
    eligibility.state.status === 'ready' && eligibility.state.value.status === 'stopped';
  const blocked = missing.length > 0 || stopped;

  async function submit() {
    if (pending || blocked) return;
    setPending(true);
    setFailure(null);
    try {
      const sent = await stepUp.run(() => submitAssisted(application.id, version));
      if (sent !== null) onSubmitted();
    } catch (error) {
      const failed = problemsOf(error);
      if (failed.list.length > 0) onRefused(failed.list, failed.detail);
      else setFailure(failed.detail);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-prose flex-col gap-5">
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-ink">
        Check before you submit
      </h2>
      <SummaryList
        items={[
          { term: 'Organisation', value: name },
          { term: 'Applicant', value: application.contact.name ?? 'Not given' },
          { term: 'Round', value: application.round.title },
          { term: 'Closes', value: closingWords(application.closesAt, application.timeZone) },
          { term: 'Answered', value: `${String(done)} of ${String(of)} questions` },
        ]}
      />
      <Panel title="Eligibility">
        <WhenLoaded
          state={eligibility.state}
          label="Checking eligibility"
          retry={eligibility.retry}
        >
          {(result) =>
            result.status === 'stopped' ? (
              <EligibilityStop explanation={result.explanation} fieldId={result.fieldId} />
            ) : result.status === 'eligible' ? (
              <Tag tone="success">Eligible</Tag>
            ) : (
              <p className="text-body text-ink">
                Eligibility cannot be checked until the eligibility questions are answered.
              </p>
            )
          }
        </WhenLoaded>
      </Panel>
      <div role="status">
        {missing.length === 0 ? (
          <p className="text-body text-ink">Every question that needs an answer has one.</p>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-ink">Still to answer</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {missing.map((problem) => (
                <li
                  key={`${problem.field}:${problem.message}`}
                  className="flex flex-col items-start gap-1"
                >
                  <span className="text-body text-ink">
                    <span className="font-medium">
                      {labels.get(problem.field.split('.')[0] ?? '') ?? 'Question'}.
                    </span>{' '}
                    {problem.message}
                  </span>
                  <Button
                    onClick={() => {
                      onBack(controlId(problem));
                    }}
                  >
                    Go to question
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {failure && (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      )}
      <p className="text-body text-muted">
        {name} will be told you submitted this application for them.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            onBack();
          }}
        >
          Back to answers
        </Button>
        <Button
          variant="primary"
          aria-disabled={pending || blocked || undefined}
          onClick={() => {
            void submit();
          }}
        >
          Submit application for {name}
        </Button>
      </div>
      {stepUp.dialog}
    </div>
  );
}
