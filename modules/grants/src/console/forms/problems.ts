// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What is wrong with a form definition, and where. The engine's rules and the
// contract's text rules, which the server applies too, say what; the path says
// where. A path counts sections and fields from 0, as the definition does.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import type { IssueLike } from '@pixel-scientists/domain/platform';
import { asProblem } from '@pixel-scientists/ui';
import type { ErrorSummaryItem } from '@pixel-scientists/ui';

import { formDefinitionInputSchema } from '../../contracts/index.ts';

export type Path = readonly (string | number)[];

export interface Problem {
  path: Path;
  message: string;
}

const UNEXPECTED = 'Something went wrong. Try again.';

/** Where a schema's issue is. A symbol is not a place a definition has, so it stands for any. */
const pathOfIssue = (path: readonly PropertyKey[]): Path =>
  path.map((key) => (typeof key === 'symbol' ? '*' : key));

/**
 * A schema's issues as problems, from `skip` steps into each path. A box that
 * breaks two rules, such as a blank title, gets the first one's words.
 */
export function problemsOf(issues: readonly IssueLike[], skip = 0): Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const issue of issues) {
    const path = pathOfIssue((issue.path ?? []).slice(skip));
    if (seen.has(path.join('.'))) continue;
    seen.add(path.join('.'));
    problems.push({ path, message: messageForIssue(issue) });
  }
  return problems;
}

/**
 * The definition as the server will read it (its text trimmed), or the
 * problems that stop it, in the words the server uses for each.
 */
export function checkDefinition(
  definition: unknown,
): { definition: FormDefinition; problems: [] } | { definition: null; problems: Problem[] } {
  const result = formDefinitionInputSchema.safeParse(definition);
  return result.success
    ? { definition: result.data, problems: [] }
    : { definition: null, problems: problemsOf(result.error.issues) };
}

/** `body.definition.sections.0.fields.1.label` names the path `sections.0.fields.1.label`. */
function pathIn(field: string): Path {
  const inside = field.replace(/^(?:body\.)?definition\.?/, '');
  return inside === ''
    ? []
    : inside.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** What the server refused, in its words. A problem with the whole request has no path. */
export function refusedProblems(error: unknown): Problem[] {
  const problem = asProblem(error);
  if (problem === null) return [{ path: [], message: UNEXPECTED }];
  if (problem.errors.length === 0) return [{ path: [], message: problem.detail }];
  return problem.errors.map(({ field, message }) => ({ path: pathIn(field), message }));
}

/** Where a problem is: a section and a field by position, and the path inside them. */
export interface Place {
  section?: number;
  field?: number;
  key: string;
}

export function placeOf(path: Path): Place {
  const [head, section, next, field, ...rest] = path;
  if (head !== 'sections' || typeof section !== 'number') return { key: path.join('.') };
  if (next !== 'fields' || typeof field !== 'number') {
    return { section, key: path.slice(2).join('.') };
  }
  return { section, field, key: rest.join('.') };
}

/** The controls of a table's column that its editor gives an id. A problem with any other part of the column is shown at its heading. */
const COLUMN_CONTROLS = ['label', 'type', 'required', 'total', 'maxCharacters'];

/** The id of the box a problem in a question is about, which the question's editor gives it. */
export function fieldControlId(key: string): string {
  const [head = '', second, third = '', fourth] = key.split('.');
  if (head === 'columns') {
    if (second === undefined) return 'field-columns-add';
    if (third === 'options') {
      return fourth === undefined
        ? `field-columns-${second}-options-add`
        : `field-columns-${second}-options-${fourth}-label`;
    }
    return `field-columns-${second}-${COLUMN_CONTROLS.includes(third) ? third : 'label'}`;
  }
  if (head === 'options')
    return second === undefined ? 'field-options-add' : `field-options-${second}-label`;
  if (head === 'conditions') {
    return second === undefined ? 'field-conditions-add' : `field-conditions-${second}`;
  }
  if (head === 'eligibility') {
    return second === 'explanation' ? 'field-eligibility-explanation' : 'field-eligibility';
  }
  return `field-${head}`;
}

/** The id of the box a problem in a section is about. */
export function sectionControlId(key: string): string {
  const head = key.split('.')[0];
  return head === 'fields'
    ? 'add-question'
    : head === 'introduction'
      ? 'section-introduction'
      : 'section-title';
}

/** "Section 2, question 3: Enter at least 1 character.", and "…, column 2:" for a problem in a table's column. */
export function inWords({ path, message }: Problem): string {
  const { section, field, key } = placeOf(path);
  if (section === undefined) return message;
  const column = /^columns\.(\d+)(?:\.|$)/.exec(key)?.[1];
  const where = [
    field === undefined ? '' : `, question ${String(field + 1)}`,
    column === undefined ? '' : `, column ${String(Number(column) + 1)}`,
  ].join('');
  return `Section ${String(section + 1)}${where}: ${message}`;
}

/** Which section and question is selected, so a summary links to a box that is on the page. */
export interface Selection {
  sectionId: string;
  /** Null when the section itself is selected. */
  fieldId: string | null;
}

/**
 * One entry for the error summary for each problem. A problem in what is
 * selected links to its box; any other links to its question in the list, or
 * to its section when that is not the one showing.
 */
export function summaryOf(
  problems: readonly Problem[],
  definition: FormDefinition,
  selected: Selection,
): ErrorSummaryItem[] {
  const seen = new Set<string>();
  const items: ErrorSummaryItem[] = [];
  for (const problem of problems) {
    const { section: s, field: f, key } = placeOf(problem.path);
    const section = s === undefined ? undefined : definition.sections[s];
    const field = f === undefined ? undefined : section?.fields[f];
    let fieldId = problem.path.length === 0 ? 'save-draft' : 'add-section';
    if (section !== undefined) {
      const showing = section.id === selected.sectionId;
      if (field === undefined) {
        fieldId =
          showing && selected.fieldId === null ? sectionControlId(key) : `outline-${section.id}`;
      } else {
        fieldId =
          showing && selected.fieldId === field.id
            ? fieldControlId(key)
            : `outline-${showing ? field.id : section.id}`;
      }
    }
    const message = inWords(problem);
    if (!seen.has(`${fieldId}:${message}`)) {
      seen.add(`${fieldId}:${message}`);
      items.push({ fieldId, message });
    }
  }
  return items;
}

/** The ids of the sections and questions that have a problem, for the lists to mark. */
export function flaggedIds(problems: readonly Problem[], definition: FormDefinition): Set<string> {
  const ids = new Set<string>();
  for (const { path } of problems) {
    const { section: s, field: f } = placeOf(path);
    const section = s === undefined ? undefined : definition.sections[s];
    if (section === undefined) continue;
    ids.add(section.id);
    const field = f === undefined ? undefined : section.fields[f];
    if (field !== undefined) ids.add(field.id);
  }
  return ids;
}

/** The messages for one place in what is selected, keyed by the path inside it. */
export function messagesAt(
  problems: readonly Problem[],
  section: number,
  field: number | undefined,
): Map<string, string> {
  const messages = new Map<string, string>();
  for (const { path, message } of problems) {
    const place = placeOf(path);
    if (place.section === section && place.field === field && !messages.has(place.key)) {
      messages.set(place.key, message);
    }
  }
  return messages;
}
