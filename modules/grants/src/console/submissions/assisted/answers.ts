// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the assisted journey asks of a form definition and its answers. Every
// decision is the form engine's, the one the server runs: this file only
// arranges its results for the screen. Files cannot be added on this route,
// so a file question is shown as it stands and never sent.

import {
  isNoAnswer,
  questionsOf,
  validateAnswers,
  visibleFields,
} from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type { SaveAnswersInput } from '../../../contracts/index.ts';

/** The id of the question a problem is about: `f_budget.2.c_cost` is a cell of `f_budget`. */
export const questionOf = (problem: FieldProblem): string =>
  problem.field.split('.')[0] ?? problem.field;

/** The id of the control a problem is about, as the form draws it: `f_address.town` is `f_address-town`. */
export function controlId(problem: FieldProblem): string {
  const [id = problem.field, ...parts] = problem.field.split('.');
  return parts.length === 0 || parts[0] === 'line1' ? id : `${id}-${parts.join('-')}`;
}

/** The questions shown for these answers, files left out. */
function asked(definition: FormDefinition, answers: Answers) {
  const shown = new Set(visibleFields(definition, answers).map(({ id }) => id));
  return questionsOf(definition).filter(({ id, type }) => shown.has(id) && type !== 'file');
}

/**
 * What is sent to be saved: the answers to shown questions that have one. An
 * answer that cannot be saved yet, such as an email address half typed, keeps
 * the answer saved before, so a save never takes away what was saved. `held`
 * names those questions.
 */
export function savable(
  definition: FormDefinition,
  answers: Answers,
  saved: Answers,
): { body: SaveAnswersInput['answers']; held: string[] } {
  const given = Object.fromEntries(
    asked(definition, answers)
      .filter((question) => !isNoAnswer(question, answers[question.id]))
      .map(({ id }) => [id, answers[id]]),
  );
  const held = [...new Set(validateAnswers(definition, given, 'draft').map(questionOf))];
  const body: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(given)) {
    if (!held.includes(id)) body[id] = value;
    else if (Object.hasOwn(saved, id)) body[id] = saved[id];
  }
  // Each answer has passed validateAnswers(), which is stricter than the request's shape.
  return { body: body as SaveAnswersInput['answers'], held };
}

/** What is still missing or wrong for the application to be submitted, from the engine, for shown questions. */
export function toFix(definition: FormDefinition, answers: Answers): FieldProblem[] {
  const shown = new Set(asked(definition, answers).map(({ id }) => id));
  return validateAnswers(definition, answers, 'submit').filter((problem) =>
    shown.has(questionOf(problem)),
  );
}

/** How many shown questions have an answer, and how many there are. */
export function progress(definition: FormDefinition, answers: Answers): [done: number, of: number] {
  const questions = asked(definition, answers);
  return [
    questions.filter((question) => !isNoAnswer(question, answers[question.id])).length,
    questions.length,
  ];
}
