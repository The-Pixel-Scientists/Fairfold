// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The editing view of a form: the outline of sections and questions, and the
// settings of whichever is selected. It holds nothing of the draft itself: it
// takes the definition and gives back the whole changed definition, so the
// screen that uses it does the saving, publishing and importing.

import type { FormDefinition, FormField } from '@pixel-scientists/domain/forms';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../Button.tsx';
import { EmptyState } from '../EmptyState.tsx';
import { blankQuestion, blankSection, conditionSources, moved } from './draft.ts';
import type { Section } from './draft.ts';
import { FieldEditor } from './FieldEditor.tsx';
import { ImportFile } from './ImportFile.tsx';
import { FieldList, SectionList } from './Outline.tsx';
import { flaggedIds, messagesAt } from './problems.ts';
import type { Problem, Selection } from './problems.ts';
import { SectionEditor } from './SectionEditor.tsx';

/** The settings whose problems show as the manager edits. The rest wait until a save is tried. */
const LIVE = new Set(['classification', 'audiences', 'allowedTypes', 'maxBytes', 'maxFiles']);

const titleOf = (section: Section | undefined) =>
  section === undefined || section.title === '' ? 'Untitled section' : section.title;

/** The first section, and its first question, to show when a form opens. */
export const firstSelection = (definition: FormDefinition): Selection => {
  const section = definition.sections[0];
  return { sectionId: section?.id ?? '', fieldId: section?.fields[0]?.id ?? null };
};

export interface FormEditorProps {
  definition: FormDefinition;
  onChange: (definition: FormDefinition) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Everything wrong with the draft, with where. */
  problems: readonly Problem[];
  /** Shows every problem beside its box. Until then only the ones that follow from a choice show. */
  showAll: boolean;
  /** Reads a form file into the draft. */
  onImport: (file: File) => void;
}

export function FormEditor({
  definition,
  onChange,
  selection,
  onSelect,
  problems,
  showAll,
  onImport,
}: FormEditorProps) {
  const [announcement, setAnnouncement] = useState('');
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [definition, selection]);

  const { sections } = definition;
  const sectionIndex = Math.max(
    0,
    sections.findIndex((item) => item.id === selection.sectionId),
  );
  const section = sections[sectionIndex];
  const fieldIndex = section?.fields.findIndex((item) => item.id === selection.fieldId) ?? -1;
  const field = section?.fields[fieldIndex];
  const flagged = flaggedIds(showAll ? problems : [], definition);

  function edit(next: readonly Section[], say = '') {
    onChange({ sections: [...next] });
    setAnnouncement(say);
  }

  function select(next: Selection) {
    onSelect(next);
    setAnnouncement('');
  }

  const changeSection = (next: Section) => {
    edit(sections.map((item, index) => (index === sectionIndex ? next : item)));
  };

  function addSection() {
    const added = blankSection();
    focusAfter.current = 'section-title';
    edit([...sections, added], 'Section added');
    onSelect({ sectionId: added.id, fieldId: null });
  }

  function moveSection(by: -1 | 1) {
    const target = sectionIndex + by;
    edit(
      moved(sections, sectionIndex, by),
      `${titleOf(section)} moved to position ${String(target + 1)} of ${String(sections.length)}`,
    );
  }

  function removeSection() {
    const rest = sections.filter((_, index) => index !== sectionIndex);
    const next = rest[Math.min(sectionIndex, rest.length - 1)];
    if (next === undefined) return;
    focusAfter.current = `outline-${next.id}`;
    edit(rest, `${titleOf(section)} removed`);
    onSelect({ sectionId: next.id, fieldId: null });
  }

  function addField() {
    if (section === undefined) return;
    const added = blankQuestion();
    focusAfter.current = 'field-label';
    changeSection({ ...section, fields: [...section.fields, added] });
    setAnnouncement('Question added');
    onSelect({ sectionId: section.id, fieldId: added.id });
  }

  const changeField = (next: FormField) => {
    if (section === undefined) return;
    changeSection({
      ...section,
      fields: section.fields.map((item) => (item.id === next.id ? next : item)),
    });
  };

  function moveField(by: -1 | 1) {
    if (section === undefined || field === undefined) return;
    changeSection({ ...section, fields: [...moved(section.fields, fieldIndex, by)] });
    setAnnouncement(
      `Question moved to position ${String(fieldIndex + by + 1)} of ${String(section.fields.length)}`,
    );
  }

  function removeField() {
    const rest = section?.fields.filter((_, index) => index !== fieldIndex) ?? [];
    const next = rest[Math.min(fieldIndex, rest.length - 1)];
    if (section === undefined || next === undefined) return;
    focusAfter.current = `outline-${next.id}`;
    changeSection({ ...section, fields: rest });
    setAnnouncement('Question removed');
    onSelect({ sectionId: section.id, fieldId: next.id });
  }

  const shown = (messages: Map<string, string>) =>
    showAll ? messages : new Map([...messages].filter(([key]) => LIVE.has(key)));

  const status = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (section === undefined) {
    return (
      <>
        {status}
        <EmptyState
          title="No sections yet"
          headingLevel="h2"
          action={
            <div className="flex flex-wrap gap-2">
              <Button id="add-section" variant="primary" onClick={addSection}>
                Add section
              </Button>
              <ImportFile replaces={false} onFile={onImport} />
            </div>
          }
        >
          <p>
            A form has sections, and each section has questions. Add a section to start building it,
            or import a form from a file.
          </p>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {status}
      <div className="grid items-start gap-x-6 gap-y-8 xl:grid-cols-[11.5rem_minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <SectionList
            sections={sections}
            currentId={section.id}
            flagged={flagged}
            onSelect={(id) => {
              select({ sectionId: id, fieldId: null });
            }}
            onAdd={addSection}
          />
          <ImportFile replaces onFile={onImport} />
        </div>
        <div className="min-w-0">
          <FieldList
            section={section}
            currentId={field?.id ?? null}
            flagged={flagged}
            onSelect={(id) => {
              select({ sectionId: section.id, fieldId: id });
            }}
            onAdd={addField}
          />
        </div>
        <div className="max-w-2xl xl:max-w-none">
          {field === undefined ? (
            <SectionEditor
              section={section}
              position={sectionIndex}
              count={sections.length}
              errors={showAll ? messagesAt(problems, sectionIndex, undefined) : new Map()}
              onChange={changeSection}
              onMove={moveSection}
              onRemove={removeSection}
            />
          ) : (
            <FieldEditor
              key={field.id}
              field={field}
              sources={conditionSources(definition, field.id)}
              position={fieldIndex}
              count={section.fields.length}
              section={section.title}
              errors={shown(messagesAt(problems, sectionIndex, fieldIndex))}
              onChange={changeField}
              onMove={moveField}
              onRemove={removeField}
            />
          )}
        </div>
      </div>
    </>
  );
}
