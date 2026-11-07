// SPDX-License-Identifier: AGPL-3.0-or-later

import { definitionProblems, parseDefinition } from '@pixel-scientists/domain/forms';
import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormEditor } from './FormEditor.tsx';
import { loweredProblems, placeOf } from './problems.ts';
import type { Problem, Selection } from './problems.ts';

function definitionOf(...fields: Record<string, unknown>[]): FormDefinition {
  const parsed = parseDefinition({
    sections: [{ id: 's_one', title: 'One', fields }],
  });
  if (!parsed.success) throw new Error('The test form is not valid.');
  return parsed.data;
}

const text = { id: 'f_text', type: 'short_text', label: 'Name of the project' };
const file = { id: 'f_file', type: 'file', label: 'Accounts', maxFiles: 1 };

/** The editor with only props, as a screen of any module gives them; it keeps the draft in state. */
function Harness({
  start,
  selected,
  onChange,
}: {
  start: FormDefinition;
  selected: string;
  onChange?: (definition: FormDefinition) => void;
}) {
  const [definition, setDefinition] = useState(start);
  const [selection, setSelection] = useState<Selection>({ sectionId: 's_one', fieldId: selected });
  const problems: Problem[] = definitionProblems(definition);
  return (
    <FormEditor
      definition={definition}
      onChange={(next) => {
        setDefinition(next);
        onChange?.(next);
      }}
      selection={selection}
      onSelect={setSelection}
      problems={problems}
      showAll={false}
      onImport={vi.fn()}
    />
  );
}

describe('the classification control', () => {
  it('shows the level the engine reads for a question stored without one, and writes nothing', () => {
    const onChange = vi.fn();
    render(<Harness start={definitionOf(text)} selected="f_text" onChange={onChange} />);

    const select = screen.getByLabelText('How sensitive is this answer?');
    expect((select as HTMLSelectElement).value).toBe('personal');
    expect(screen.getByText('Personal: about a named person.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers the four levels in the engine order, in plain words', () => {
    render(<Harness start={definitionOf(text)} selected="f_text" />);

    const options = within(screen.getByLabelText('How sensitive is this answer?')).getAllByRole(
      'option',
    );
    expect(options.map((option) => option.textContent)).toEqual([
      'Public',
      'Internal',
      'Personal',
      'Special category',
    ]);
  });

  it('writes the level when the manager chooses it, and explains special category without changing who sees it', async () => {
    const onChange = vi.fn();
    render(<Harness start={definitionOf(text)} selected="f_text" onChange={onChange} />);

    await userEvent.selectOptions(
      screen.getByLabelText('How sensitive is this answer?'),
      'special_category',
    );

    const written = onChange.mock.calls.at(-1)?.[0] as FormDefinition;
    expect(written.sections[0]?.fields[0]).toMatchObject({
      classification: 'special_category',
      audiences: ['applicant', 'staff', 'reviewer'],
    });
    expect(screen.getByText(/see these only in totals/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Who sees the answer').value).toBe('everyone');
  });

  it('shows the engine problem beside the question as soon as the choice causes it', async () => {
    render(<Harness start={definitionOf(text)} selected="f_text" />);

    await userEvent.selectOptions(
      screen.getByLabelText('How sensitive is this answer?'),
      'special_category',
    );

    expect(
      screen.getByText('Show answers to special category questions only in totals.'),
    ).toBeTruthy();
  });

  it('is not on a text block', () => {
    render(
      <Harness
        start={definitionOf({ id: 'f_note', type: 'content', body: 'Read this first.' })}
        selected="f_note"
      />,
    );

    expect(screen.queryByLabelText('How sensitive is this answer?')).toBeNull();
  });

  it('keeps the level when the type changes', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        start={definitionOf({ ...text, classification: 'internal' })}
        selected="f_text"
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'email');

    expect(
      (onChange.mock.calls.at(-1)?.[0] as FormDefinition).sections[0]?.fields[0],
    ).toMatchObject({
      type: 'email',
      classification: 'internal',
    });
  });
});

describe('the file question editor', () => {
  it('lists the file types by plain name and limits the size and number of files', () => {
    render(<Harness start={definitionOf(file)} selected="f_file" />);

    const types = screen.getByRole('group', { name: 'File types' });
    expect(within(types).getByLabelText<HTMLInputElement>('PDF').checked).toBe(true);
    expect(within(types).getByLabelText<HTMLInputElement>('Word document').checked).toBe(true);
    expect(screen.getByLabelText('Largest file')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Most files').value).toBe('1');
  });

  it('does not offer to show a file only in totals', () => {
    render(<Harness start={definitionOf(file)} selected="f_file" />);

    const options = within(screen.getByLabelText('Who sees the answer')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).not.toContain('Only in totals');
  });

  it('is not offered an eligibility rule', () => {
    render(<Harness start={definitionOf(file, text)} selected="f_file" />);

    expect(screen.queryByText('Eligibility')).toBeNull();
  });

  it('writes the types that stay ticked', async () => {
    const onChange = vi.fn();
    render(<Harness start={definitionOf(file)} selected="f_file" onChange={onChange} />);

    await userEvent.click(
      within(screen.getByRole('group', { name: 'File types' })).getByLabelText('PDF'),
    );

    const written = onChange.mock.calls.at(-1)?.[0] as FormDefinition;
    expect(written.sections[0]?.fields[0]).toMatchObject({ type: 'file' });
    expect(JSON.stringify(written)).not.toContain('application/pdf');
  });
});

describe('earlier versions', () => {
  it('flags a question classified lower than an earlier version did, beside the field', () => {
    const earlier = definitionOf({ ...text, classification: 'personal' });
    const draft = definitionOf({ ...text, classification: 'internal' });

    const problems = loweredProblems([earlier], draft);

    expect(problems).toHaveLength(1);
    expect(placeOf(problems[0]?.path ?? [])).toEqual({
      section: 0,
      field: 0,
      key: 'classification',
    });
    expect(loweredProblems([earlier], earlier)).toEqual([]);
  });

  it('treats a question stored without a level as the level the engine reads', () => {
    const earlier = definitionOf(text);
    const draft = definitionOf({ ...text, classification: 'internal' });

    expect(loweredProblems([earlier], draft)).toHaveLength(1);
  });
});
