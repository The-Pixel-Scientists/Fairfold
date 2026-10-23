// SPDX-License-Identifier: AGPL-3.0-or-later

import { fieldsOf } from '@pixel-scientists/domain/forms';
import { DataTable, EmptyState, Panel } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { EligibilityCheck, Submission } from '../../../contracts/index.ts';
import { formatMoment } from '../../programme/format.ts';
import { EligibilityTag } from '../words.tsx';

/** The question a check stopped at, as the pinned form words it, and what the form tells the applicant. */
function questionOf(submission: Submission, fieldId: string | null) {
  const field = fieldsOf(submission.form.definition).find(({ id }) => id === fieldId);
  if (field === undefined || field.type === 'content') return null;
  const explanation = 'eligibility' in field ? field.eligibility?.explanation : undefined;
  return { label: field.label, explanation };
}

/** Every eligibility check recorded for the submission, the latest first, with the question that stopped it when one did. */
export function EligibilityTab({ submission }: { submission: Submission }) {
  const { eligibilityChecks } = submission;
  const [latest] = eligibilityChecks;
  const columns: readonly Column<EligibilityCheck>[] = [
    {
      key: 'checked',
      header: 'Checked',
      rowHeader: true,
      cell: (check) => formatMoment(check.checkedAt),
    },
    {
      key: 'result',
      header: 'Result',
      cell: (check) => <EligibilityTag outcome={check.outcome} />,
    },
    {
      key: 'question',
      header: 'Stopped at',
      cell: (check) => {
        const question = questionOf(submission, check.fieldId);
        return question === null ? (
          <span className="text-muted">Not stopped</span>
        ) : (
          <span className="block max-w-sm whitespace-normal">{question.label}</span>
        );
      },
    },
  ];

  if (latest === undefined) {
    return (
      <EmptyState title="No eligibility check yet">
        <p>
          A check is recorded when the applicant answers the form's eligibility questions. This
          submission has none on record.
        </p>
      </EmptyState>
    );
  }
  const stopped = latest.outcome === 'stopped' ? questionOf(submission, latest.fieldId) : null;
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-body text-muted">
        Each check is made against the form version the applicant used. A person makes the final
        call on eligibility.
      </p>
      {stopped && (
        <Panel title="Where the applicant was stopped">
          <p className="text-body text-ink">
            The answer to <span className="font-medium">{stopped.label}</span> stopped this
            application.
          </p>
          {stopped.explanation !== undefined && (
            <p className="text-body text-muted">{stopped.explanation}</p>
          )}
        </Panel>
      )}
      <DataTable
        caption="Eligibility checks, latest first"
        columns={columns}
        rows={eligibilityChecks}
        rowKey={(check) => check.checkedAt}
      />
    </div>
  );
}
