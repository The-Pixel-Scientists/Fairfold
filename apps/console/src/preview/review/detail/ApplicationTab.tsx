// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Tag } from '@pixel-scientists/ui';
import { Fragment } from 'react';

import { AnswerSection, BudgetTable } from '../ApplicationParts.tsx';
import { answers, budget, documents, otherFunding, staffForm } from '../featured.ts';
import { formVersion } from '../form.ts';

/** Read-only answers for staff, by section, with the budget as a table and the documents as a list. */
export function ApplicationTab() {
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-prose text-body text-muted">
        What Sam Patel submitted on 1 March 2027 at 2:14pm, against form version{' '}
        {formVersion.number}. Staff see every answer; reviewers do not see who the organisation is.
      </p>

      {staffForm.sections.map((section) => (
        <Fragment key={section.id}>
          <AnswerSection section={section} answers={answers} />
          {section.id === 'project' && <BudgetTable lines={budget} otherFunding={otherFunding} />}
          {section.id === 'outcomes' && <Documents />}
        </Fragment>
      ))}
    </div>
  );
}

function Documents() {
  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-2">
      <h2 id="documents-heading" className="text-lg font-semibold text-ink">
        Documents
      </h2>
      <ul className="flex flex-col divide-y divide-divider">
        {documents.map((document) => (
          <li
            key={document.name}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-medium break-words text-ink">{document.name}</span>
              <span className="text-sm text-muted">
                {document.kind}, {document.size}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Tag tone="success">Ready</Tag>
              <Button variant="quiet">
                Download<span className="sr-only"> {document.name}</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
