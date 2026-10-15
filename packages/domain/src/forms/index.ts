// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form engine: the `/forms` subpath of the domain package.

import '../jitless/index.ts';

export {
  answersSchema,
  answerValueSchema,
  cellValueSchema,
  tableRowsSchema,
  ukAddressSchema,
  type UkAddress,
} from './answers.ts';
export { canSee, projectionAudiences, type ProjectionAudience } from './audience.ts';
export {
  audiencesSchema,
  CELL_MAX_CHARACTERS,
  columnIdSchema,
  conditionSchema,
  fieldAudiences,
  fieldIdSchema,
  fieldSchema,
  fieldsOf,
  LONG_TEXT_MAX_CHARACTERS,
  optionValueSchema,
  questionsOf,
  sectionIdSchema,
  sectionSchema,
  SHORT_TEXT_MAX_CHARACTERS,
  TABLE_MAX_ROWS,
  tableColumnSchema,
  type Condition,
  type FormField,
  type Question,
  type TableColumn,
  type TableField,
} from './definition.ts';
export { checkEligibility, type EligibilityResult } from './eligibility.ts';
export { formMessages, MAX_FIELDS } from './messages.ts';
export { projectAnswers } from './project.ts';
export {
  changedFieldTypes,
  definitionProblems,
  formDefinitionSchema,
  parseDefinition,
  type FormDefinition,
} from './rules.ts';
export { tableTotals, type TableTotal } from './table.ts';
export { validateAnswers, type ValidationMode } from './validate.ts';
export { visibleFields, type Answers } from './visibility.ts';
export { countCharacters, countWords } from './words.ts';
