// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the apply screens ask of a form definition and its answers. Every
// decision is the form engine's, the one the server runs: this file only
// arranges its results for the screens. Eligibility questions are drawn first,
// on a screen of their own, and the form's sections follow.
//
// A file question's answer is the ids of the files attached to it. The server
// adds them from its list of files, so they are never sent: `withFiles()` adds
// them to the answers from the list the screens hold, for the checks.

import { projectAnswers, validateAnswers, visibleFields } from '@pixel-scientists/domain/forms';
import type { SaveAnswersInput } from '@pixel-scientists/grants/contracts';
import type {
  Answers,
  FormDefinition,
  FormField,
  ValidationMode,
} from '@pixel-scientists/domain/forms';

/** One screen of questions: the eligibility questions, or one of the form's sections. */
export interface Screen {
  /** `ELIGIBILITY_SCREEN`, or the section's id. */
  id: string;
  title: string;
  introduction?: string | undefined;
  fields: FormField[];
}

export const ELIGIBILITY_SCREEN = 'eligibility';

export interface Problem {
  field: string;
  message: string;
}

const hasEligibility = (field: FormField): boolean =>
  'eligibility' in field && field.eligibility !== undefined;

/** The id of the question a problem is about: `f_budget.2.c_cost` is a cell of `f_budget`. */
export const questionOf = (problem: Problem): string =>
  problem.field.split('.')[0] ?? problem.field;

/** Whether the answer says anything. A blank string, an empty list and no answer all say nothing. */
export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return !Array.isArray(value) || value.length > 0;
}

/**
 * The screens a form has, whatever the answers: eligibility questions on
 * the first, wherever the form puts them, then each section without them.
 * A section left with nothing to draw has no screen.
 */
export function screensOf(definition: FormDefinition): Screen[] {
  const eligibility = definition.sections
    .flatMap((section) => section.fields)
    .filter(hasEligibility);
  const sections = definition.sections.map(({ id, title, introduction, fields }) => ({
    id,
    title,
    introduction,
    fields: fields.filter((field) => !hasEligibility(field)),
  }));
  return [
    ...(eligibility.length === 0
      ? []
      : [
          {
            id: ELIGIBILITY_SCREEN,
            title: 'Check you can apply',
            introduction:
              'Answer these questions first. If you cannot apply, we tell you why before you write anything else.',
            fields: eligibility,
          },
        ]),
    ...sections.filter((section) => section.fields.length > 0),
  ];
}

/** The ids of the fields shown for these answers. */
export function shownIds(definition: FormDefinition, answers: Answers): Set<string> {
  return new Set(visibleFields(definition, answers).map((field) => field.id));
}

/** The screens with something to show for these answers, in order. A section with no shown question is skipped. */
export function shownScreens(definition: FormDefinition, answers: Answers): Screen[] {
  const shown = shownIds(definition, answers);
  return screensOf(definition).filter((screen) => screen.fields.some(({ id }) => shown.has(id)));
}

function fileIds(definition: FormDefinition): string[] {
  return definition.sections.flatMap((section) =>
    section.fields.filter((field) => field.type === 'file').map(({ id }) => id),
  );
}

/**
 * The answers with each shown file question's answer set to the ids of the
 * files attached to it, and left out when it has none. A file on a question
 * that is not shown is not an answer, as on the server.
 */
export function withFiles(
  definition: FormDefinition,
  answers: Answers,
  files: readonly { id: string; fieldId: string }[],
): Answers {
  const shown = shownIds(definition, answers);
  const asked = fileIds(definition);
  const attached = asked
    .filter((field) => shown.has(field))
    .map((field): [string, string[]] => [
      field,
      files.filter(({ fieldId }) => fieldId === field).map(({ id }) => id),
    ])
    .filter(([, ids]) => ids.length > 0);
  return {
    ...Object.fromEntries(Object.entries(answers).filter(([id]) => !asked.includes(id))),
    ...Object.fromEntries(attached),
  };
}

/** The engine's problems with the answers, which hold file ids as `withFiles()` makes them. */
export function problemsOf(
  definition: FormDefinition,
  answers: Answers,
  mode: ValidationMode,
): Problem[] {
  return validateAnswers(definition, answers, mode);
}

/** The questions on a screen that are shown for these answers. */
export function questionsOn(screen: Screen, shown: ReadonlySet<string>): FormField[] {
  return screen.fields.filter((field) => field.type !== 'content' && shown.has(field.id));
}

export type ScreenStatus = 'not-started' | 'in-progress' | 'completed';

/** Where a screen stands: nothing answered, answers that still have problems, or all well. */
export function statusOf(
  screen: Screen,
  shown: ReadonlySet<string>,
  answers: Answers,
  problems: readonly Problem[],
): ScreenStatus {
  const questions = questionsOn(screen, shown);
  if (questions.length === 0) return 'completed';
  if (!questions.some(({ id }) => isAnswered(answers[id]))) return 'not-started';
  const ids = new Set(questions.map(({ id }) => id));
  return problems.some((problem) => ids.has(questionOf(problem))) ? 'in-progress' : 'completed';
}

/** How many questions on a screen still have a problem. */
export function questionsLeft(
  screen: Screen,
  shown: ReadonlySet<string>,
  problems: readonly Problem[],
): number {
  const ids = new Set(questionsOn(screen, shown).map(({ id }) => id));
  return new Set(problems.map(questionOf).filter((id) => ids.has(id))).size;
}

/**
 * What is sent to be saved: the answers to shown questions that have an
 * answer, in the form's order. A question whose answer cannot be saved yet,
 * such as an email address half typed, keeps the answer saved before, so a
 * save never takes away what was saved. `held` names those questions.
 */
export function savable(
  definition: FormDefinition,
  answers: Answers,
  saved: Answers,
): { body: SaveAnswersInput['answers']; held: string[] } {
  const files = new Set(fileIds(definition));
  const given = Object.fromEntries(
    Object.entries(projectAnswers(definition, answers, 'applicant')).filter(
      ([id, value]) => !files.has(id) && isAnswered(value),
    ),
  );
  const held = [...new Set(problemsOf(definition, given, 'draft').map(questionOf))];
  const body: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(given)) {
    if (!held.includes(id)) body[id] = value;
    else if (Object.hasOwn(saved, id)) body[id] = saved[id];
  }
  // Each answer has passed validateAnswers(), which is stricter than the request's shape.
  return { body: body as SaveAnswersInput['answers'], held };
}

/** The id of the control a problem is about, as the form draws it: `f_address.town` is `f_address-town`. */
export function controlId(problem: Problem): string {
  const [id = problem.field, ...parts] = problem.field.split('.');
  return parts.length === 0 || parts[0] === 'line1' ? id : `${id}-${parts.join('-')}`;
}

/** One thing to fix before the application can be sent, with where to fix it. */
export interface ToFix {
  screen: Screen;
  controlId: string;
  label: string;
  message: string;
}

/** Each problem with the answers, with the screen that asks the question. */
export function toFix(screens: readonly Screen[], problems: readonly Problem[]): ToFix[] {
  return problems.flatMap((problem) => {
    for (const screen of screens) {
      const field = screen.fields.find(({ id }) => id === questionOf(problem));
      if (field !== undefined && field.type !== 'content') {
        return [
          { screen, controlId: controlId(problem), label: field.label, message: problem.message },
        ];
      }
    }
    return [];
  });
}

/** Minutes to answer one field: a minute for a short answer, more for writing, a table or a file. */
function minutesFor(field: FormField): number {
  switch (field.type) {
    case 'content':
      return 0;
    case 'long_text':
      return field.maxWords === undefined ? 5 : Math.max(2, field.maxWords / 25);
    case 'table':
      return 5;
    case 'file':
      return 3;
    default:
      return 1;
  }
}

/** About how many minutes a form takes, to the nearest five and at least five. */
export function minutesToAnswer(definition: FormDefinition): number {
  const total = definition.sections
    .flatMap((section) => section.fields)
    .reduce((sum, field) => sum + minutesFor(field), 0);
  return Math.max(5, Math.round(total / 5) * 5);
}

/** The time a form takes, in words: "about 30 minutes", "about an hour", "about 2 hours". */
export function timeWords(minutes: number): string {
  if (minutes < 60) return `about ${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${String(hours)} hours`;
}

/** What an applicant needs to have ready: the files and the tables the form asks for. */
export function needsOf(definition: FormDefinition): { title: string; text: string }[] {
  return definition.sections.flatMap((section) =>
    section.fields.flatMap((field) => {
      if (field.type === 'file') {
        return [{ title: field.label, text: field.hint ?? 'You will upload a file.' }];
      }
      if (field.type === 'table') {
        return [{ title: field.label, text: field.hint ?? 'You will fill in a table.' }];
      }
      return [];
    }),
  );
}

/** Why some applicants cannot apply, in the funder's words, before anyone starts. */
export function stopsOf(definition: FormDefinition): string[] {
  return [
    ...new Set(
      definition.sections.flatMap((section) =>
        section.fields.flatMap((field) =>
          'eligibility' in field && field.eligibility !== undefined
            ? [field.eligibility.explanation]
            : [],
        ),
      ),
    ),
  ];
}
