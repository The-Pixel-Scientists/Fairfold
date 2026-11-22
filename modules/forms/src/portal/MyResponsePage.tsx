// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One answered form, as the person sent it: their own answers, as the server
// shows them to a respondent, and nothing the funder added.

import { canSee, visibleFields } from '@pixel-scientists/domain/forms';
import type { Answers } from '@pixel-scientists/domain/forms';
import {
  AnswerView,
  Link,
  LoadingState,
  NotFoundPage,
  PageHeading,
  buttonClassName,
  useParams,
} from '@pixel-scientists/ui';
import { useCallback } from 'react';

import { getMyResponse } from '../contracts/index.ts';
import { dateOf } from './dates.ts';
import { helpers } from './helpers.ts';
import { useFormsHost } from './host.tsx';
import { LoadFailed } from './LoadFailed.tsx';
import { RESPONSES_PATH } from './paths.ts';
import { useLoad } from './useLoad.ts';

export default function MyResponsePage() {
  const { responseId = '' } = useParams();
  const { call } = useFormsHost();
  const read = useCallback(
    () => call(getMyResponse, { params: { responseId } }),
    [call, responseId],
  );
  const { load, retry } = useLoad(read, responseId);

  if (load.status === 'loading') return <LoadingState label="Loading your answers" />;
  if (load.status === 'missing') return <NotFoundPage />;
  if (load.status === 'failed') return <LoadFailed retry={retry} />;

  const { formTitle, submittedAt, definition } = load.data;
  const answers = load.data.answers as Answers;
  const visible = visibleFields(definition, answers).filter((field) => canSee(field, 'respondent'));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4 sm:py-10">
      <div className="flex flex-col gap-2">
        <PageHeading className="text-3xl sm:text-4xl">{formTitle}</PageHeading>
        <p className="text-lg text-ink">Sent on {dateOf(submittedAt)}</p>
      </div>
      <AnswerView
        sections={definition.sections}
        visible={visible}
        answers={answers}
        helpers={helpers}
        headingLevel="h2"
      />
      <div>
        <Link to={RESPONSES_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
          Back to your answers
        </Link>
      </div>
    </div>
  );
}
