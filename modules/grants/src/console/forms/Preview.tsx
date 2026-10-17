// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form as an applicant sees it, a section at a time, with the same
// renderer and the same engine: conditions show and hide questions as they
// are answered, and an answer that stops applicants stops them. Answers are
// kept only until the page closes, and no file is sent: a file question shows
// its limits and checks a chosen file against them, and that is all.

import { ProblemError } from '@pixel-scientists/domain/api';
import { fileTypeLabels, sniffFileType } from '@pixel-scientists/domain/files';
import {
  checkEligibility,
  checkFile,
  countCharacters,
  countWords,
  fieldsOf,
  tableTotals,
  visibleFields,
} from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import { Button, EligibilityStop, FormSection, SectionProgress, Tag } from '@pixel-scientists/ui';
import type { FileHelpers, FormFiles, FormHelpers } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

const helpers: FormHelpers & FileHelpers = {
  countWords,
  countCharacters,
  formatMoney,
  tableTotals,
  fileTypeLabels,
  sniffFileType,
  checkFile,
};

/** A form with nowhere to send files: choosing one is refused, in words that say why. */
const noUploads: FormFiles = {
  files: [],
  hrefFor: () => '',
  onUpload: () =>
    Promise.reject(new ProblemError(403, 'Uploading is switched off in the preview.')),
  onRemove: () => undefined,
};

export function Preview({ definition }: { definition: FormDefinition }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const visible = visibleFields(definition, answers);
  const shown = new Set(visible.map((field) => field.id));
  const sections = definition.sections.filter((section) =>
    section.fields.some((field) => shown.has(field.id)),
  );
  const index = Math.min(step, sections.length - 1);
  const section = sections[index];
  const eligibility = checkEligibility(definition, answers);

  useEffect(() => {
    if (!moved.current) return;
    // A person starts reading a section at its heading, as in the portal.
    const heading = top.current?.querySelector('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }, [index]);

  if (section === undefined) return null;
  const go = (by: -1 | 1) => {
    moved.current = true;
    setStep(index + by);
  };

  return (
    <div ref={top} className="flex max-w-prose flex-col gap-stack">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted">
        <Tag tone="info">Preview</Tag>
        <span>This is how applicants see the form. Nothing you enter here is saved.</span>
      </p>
      {fieldsOf(definition).some((field) => field.type === 'file') && (
        <p className="text-body text-muted">
          Uploading is switched off in the preview. You can choose a file to check it against the
          limits, but nothing is sent.
        </p>
      )}
      <SectionProgress current={index + 1} total={sections.length} />
      <FormSection
        key={section.id}
        section={section}
        visible={visible}
        answers={answers}
        helpers={helpers}
        files={noUploads}
        onChange={(fieldId, value) => {
          setAnswers((current) => {
            const rest = Object.fromEntries(
              Object.entries(current).filter(([id]) => id !== fieldId),
            );
            return value === null ? rest : { ...rest, [fieldId]: value };
          });
        }}
      />
      {eligibility.status === 'stopped' && (
        <EligibilityStop
          explanation={eligibility.explanation}
          fieldId={eligibility.fieldId}
          headingLevel="h3"
        />
      )}
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
        {index < sections.length - 1 && eligibility.status !== 'stopped' && (
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
