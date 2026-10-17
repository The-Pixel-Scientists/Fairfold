// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A rubric as the form holds it, and the request it becomes. The numbers are
// held as typed, so a box can be empty while someone types; a number that is
// not a whole number is refused here, in words about its box. The contract's
// own checks (a label, a weight from 1 to 100, a lowest score under the
// highest) run on the rest.

import type { FieldProblem } from '@pixel-scientists/domain/platform';

import { rubricInputSchema } from '../../contracts/index.ts';
import type { Criterion } from '../../contracts/index.ts';
import { refuseUnless } from './problems.ts';

export interface Item {
  /** Keeps a row's place while its text changes and the rows move. */
  key: string;
  /** Left out for a criterion that has not been saved yet. */
  id?: string;
  label: string;
  guidance: string;
  weight: string;
  scaleMin: string;
  scaleMax: string;
}

export const BOXES = ['label', 'weight', 'scaleMin', 'scaleMax', 'guidance'] as const;

export const itemsOf = (criteria: readonly Criterion[]): Item[] =>
  criteria.map(({ id, label, guidance, weight, scaleMin, scaleMax }) => ({
    key: id,
    id,
    label,
    guidance,
    weight: String(weight),
    scaleMin: String(scaleMin),
    scaleMax: String(scaleMax),
  }));

/** What the API keeps of the rows, to tell whether they have changed. */
export const contentOf = (items: readonly Item[]) =>
  JSON.stringify(
    items.map(({ id, label, guidance, weight, scaleMin, scaleMax }) => [
      id,
      label,
      guidance,
      weight,
      scaleMin,
      scaleMax,
    ]),
  );

/** A weight or score typed in a box, or 0 for text that is not a whole number. */
export const numberOf = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text) : 0);

export const boxId = (index: number, box: string) => `criterion-${String(index)}-${box}`;

/** `body.criteria.1.weight` is the box for the second criterion's weight. */
export function boxFor(field: string): string {
  const [, index, box = ''] = /^body\.criteria\.(\d+)\.(\w+)/.exec(field) ?? [];
  if (index === undefined) return 'add-criterion';
  return boxId(Number(index), box === 'id' ? 'label' : box);
}

/** The place of a field in the form: criterion by criterion, box by box. */
function rank(field: string): number {
  const [, index = '0', box = ''] = /^body\.criteria\.(\d+)\.(\w+)/.exec(field) ?? [];
  return Number(index) * 10 + Math.max(BOXES.indexOf(box === 'id' ? 'label' : (box as 'label')), 0);
}

function whole(text: string, field: string, message: string, problems: FieldProblem[]): number {
  if (!/^\d+$/.test(text.trim())) problems.push({ field, message });
  return numberOf(text);
}

/** The request for a rubric, or a refusal naming everything wrong with it. */
export function rubricBody(items: readonly Item[]) {
  const problems: FieldProblem[] = [];
  const criteria = items.map((item, index) => {
    const at = (box: string) => `body.criteria.${String(index)}.${box}`;
    return {
      ...(item.id === undefined ? {} : { id: item.id }),
      label: item.label,
      guidance: item.guidance,
      weight: whole(item.weight, at('weight'), 'Enter a weight from 1 to 100.', problems),
      scaleMin: whole(item.scaleMin, at('scaleMin'), 'Enter a lowest score from 0 to 9.', problems),
      scaleMax: whole(
        item.scaleMax,
        at('scaleMax'),
        'Enter a highest score from 1 to 10.',
        problems,
      ),
    };
  });
  const body = { criteria };
  refuseUnless(rubricInputSchema, body, problems, rank);
  return body;
}
