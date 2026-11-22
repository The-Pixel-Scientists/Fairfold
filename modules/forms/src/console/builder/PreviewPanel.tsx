// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import {
  Button,
  EmptyState,
  FormField,
  Notice,
  Select,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { Preview } from '@pixel-scientists/ui/form-builder';
import { useState } from 'react';

import { previewAudiences, previewFormDraft } from '../../contracts/index.ts';

type Audience = (typeof previewAudiences)[number];

const audienceWords: Record<Audience, string> = {
  respondent: 'A person answering',
  staff: 'Staff reading responses',
};

/** What the server will show this audience: the questions it lists, in their sections. */
export function shownTo(definition: FormDefinition, visibleFieldIds: readonly string[]) {
  const visible = new Set(visibleFieldIds);
  return {
    sections: definition.sections
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => visible.has(field.id)),
      }))
      .filter((section) => section.fields.length > 0),
  } satisfies FormDefinition;
}

async function load(key: string) {
  const [audience = 'respondent', formId = ''] = JSON.parse(key) as string[];
  const preview = await call(previewFormDraft, {
    params: { formId },
    query: { audience },
  });
  return shownTo(preview.definition, preview.visibleFieldIds);
}

function Shown({
  formId,
  audience,
  savedAt,
}: {
  formId: string;
  audience: Audience;
  savedAt: string;
}) {
  const { state, retry } = useLoad(load, JSON.stringify([audience, formId, savedAt]));
  return (
    <WhenLoaded state={state} label="Loading the preview" retry={retry}>
      {(definition) =>
        definition.sections.length === 0 ? (
          <EmptyState title="No questions to show" headingLevel="h2">
            <p>
              {audience === 'staff'
                ? 'Staff see none of the questions in this draft, or it has none yet.'
                : 'Add a question in the Edit form tab to see it here.'}
            </p>
          </EmptyState>
        ) : (
          <Preview definition={definition} />
        )
      }
    </WhenLoaded>
  );
}

export interface PreviewPanelProps {
  formId: string;
  /** Whether the draft has changes the server has not seen, which a preview would leave out. */
  dirty: boolean;
  /** When the draft was last saved, so a new save is previewed. */
  savedAt: string;
  onSave: () => void;
}

/** The saved draft as the server shows it to an audience. Nothing is stored. */
export function PreviewPanel({ formId, dirty, savedAt, onSave }: PreviewPanelProps) {
  const [audience, setAudience] = useState<Audience>('respondent');
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Preview as" className="max-w-72">
        <Select
          value={audience}
          onChange={(event) => {
            setAudience(event.target.value as Audience);
          }}
        >
          {previewAudiences.map((value) => (
            <option key={value} value={value}>
              {audienceWords[value]}
            </option>
          ))}
        </Select>
      </FormField>
      <Notice tone="info" title="Preview only. Answers are not saved." />
      {dirty ? (
        <EmptyState
          title="Save the draft to preview it"
          headingLevel="h2"
          action={<Button onClick={onSave}>Save draft</Button>}
        >
          <p>The preview shows the saved draft, so it leaves out changes you have not saved.</p>
        </EmptyState>
      ) : (
        <Shown formId={formId} audience={audience} savedAt={savedAt} />
      )}
    </div>
  );
}
