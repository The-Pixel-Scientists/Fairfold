// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileTypeLabels } from '@pixel-scientists/domain/files';
import { canSee, tableTotals, visibleFields } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import { AnswerView } from '@pixel-scientists/ui';
import type { AnswerHelpers } from '@pixel-scientists/ui';

import type { AttachmentView, Submission } from '../../../contracts/index.ts';
import { formatMoment } from '../../programme/format.ts';
import { downloadHref } from '../loaders.ts';

const helpers: AnswerHelpers = { formatMoney, tableTotals, fileTypeLabels };

/** The answers by section, read only, as staff may see them on the form version the applicant used. */
export function ApplicationTab({
  submission,
  files,
}: {
  submission: Submission;
  files: readonly AttachmentView[];
}) {
  const { definition, version } = submission.form;
  const visible = visibleFields(definition, submission.answers).filter((field) =>
    canSee(field, 'staff'),
  );
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-body text-muted">
        What was submitted on {formatMoment(submission.submittedAt)}, on version {version} of the
        form.
      </p>
      <AnswerView
        sections={definition.sections}
        visible={visible}
        answers={submission.answers}
        helpers={helpers}
        files={files}
        hrefFor={(id) => downloadHref(submission.id, id)}
        noFiles="No files uploaded"
        headingLevel="h2"
      />
    </div>
  );
}
