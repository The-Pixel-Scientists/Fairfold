// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormField, Input, Panel, Textarea } from '@pixel-scientists/ui';
import { useState } from 'react';

import { Arrange } from './Arrange.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { Section } from './draft.ts';
import type { Errors } from './Settings.tsx';

export interface SectionEditorProps {
  section: Section;
  position: number;
  count: number;
  errors: Errors;
  onChange: (section: Section) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** A section's title and introduction. Removing a section removes its questions, so it asks first. */
export function SectionEditor({
  section,
  position,
  count,
  errors,
  onChange,
  onMove,
  onRemove,
}: SectionEditorProps) {
  const [asking, setAsking] = useState(false);
  const name = section.title === '' ? 'this section' : section.title;
  const questions = section.fields.length;

  return (
    <Panel title="Edit section">
      <p className="-mt-2 text-sm text-muted">
        Section {position + 1} of {count}
      </p>
      <FormField id="section-title" label="Title" error={errors.get('title')}>
        <Input
          value={section.title}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...section, title: event.currentTarget.value });
          }}
        />
      </FormField>
      <FormField
        id="section-introduction"
        label="Introduction"
        optional
        error={errors.get('introduction')}
      >
        <Textarea
          rows={3}
          value={section.introduction ?? ''}
          onChange={(event) => {
            const introduction = event.currentTarget.value;
            onChange({ ...section, introduction: introduction === '' ? undefined : introduction });
          }}
        />
      </FormField>
      <Arrange
        name={name}
        position={position}
        count={count}
        keepsOne="A form keeps at least one section. Add another before you remove this one."
        onMove={onMove}
        onRemove={() => {
          setAsking(true);
        }}
      />
      <ConfirmDialog
        open={asking}
        title="Remove this section?"
        description={`This removes ${name} and its ${String(questions)} ${questions === 1 ? 'question' : 'questions'} from the draft.`}
        confirm="Remove section"
        cancel="Keep section"
        danger
        onConfirm={() => {
          setAsking(false);
          onRemove();
        }}
        onClose={() => {
          setAsking(false);
        }}
      />
    </Panel>
  );
}
