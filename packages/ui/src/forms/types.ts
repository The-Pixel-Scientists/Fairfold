// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form components need to know about a form definition and its
// answers. These are the shapes of the domain package's form engine, written
// out so the library imports none of it: the engine's `FormField` and section
// types fit them, and an app passes in the engine's results, such as
// `visibleFields()` and `validateAnswers()`.

/** The name of an option and the words shown for it. */
export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

interface ColumnBase {
  /** Stable. A table's cells are keyed by it, within their row. */
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
}

/** One column of a table question, asked as the question of the same type. */
export type TableColumnDefinition =
  | (ColumnBase & { readonly type: 'short_text'; readonly maxCharacters?: number | undefined })
  | (ColumnBase & {
      readonly type: 'number';
      readonly wholeNumber: boolean;
      readonly total?: boolean | undefined;
    })
  | (ColumnBase & {
      readonly type: 'currency';
      readonly currency: 'GBP';
      readonly total?: boolean | undefined;
    })
  | (ColumnBase & { readonly type: 'dropdown'; readonly options: readonly ChoiceOption[] });

interface QuestionBase {
  /** Stable. Answers are keyed by it, and it is the id of the control. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly required: boolean;
}

export type FormFieldDefinition =
  | (QuestionBase & {
      readonly type: 'short_text' | 'long_text';
      readonly maxWords?: number | undefined;
      readonly maxCharacters?: number | undefined;
    })
  | (QuestionBase & { readonly type: 'number'; readonly wholeNumber: boolean })
  | (QuestionBase & { readonly type: 'currency'; readonly currency: 'GBP' })
  | (QuestionBase & {
      readonly type: 'date' | 'email' | 'phone' | 'url' | 'yes_no' | 'uk_address';
    })
  | (QuestionBase & {
      readonly type: 'single_choice' | 'dropdown';
      readonly options: readonly ChoiceOption[];
    })
  | (QuestionBase & {
      readonly type: 'multiple_choice';
      readonly options: readonly ChoiceOption[];
      readonly minSelections?: number | undefined;
      readonly maxSelections?: number | undefined;
    })
  | (QuestionBase & {
      readonly type: 'table';
      /** One row, in the singular: "cost" gives "Cost 2" and "Add another cost". */
      readonly rowNoun: string;
      readonly minRows: number;
      readonly maxRows: number;
      readonly columns: readonly TableColumnDefinition[];
    })
  /** Text for the applicant to read. It takes no answer. */
  | { readonly id: string; readonly type: 'content'; readonly body: string };

/** A field that takes an answer. */
export type QuestionDefinition = Exclude<FormFieldDefinition, { readonly type: 'content' }>;

export type TableFieldDefinition = Extract<QuestionDefinition, { readonly type: 'table' }>;

export interface FormSectionDefinition {
  readonly id: string;
  readonly title: string;
  readonly introduction?: string | undefined;
  readonly fields: readonly FormFieldDefinition[];
}

/** Answers keyed by field id, as an application holds them. */
export type FormAnswers = Readonly<Record<string, unknown>>;

/** The fields shown for these answers, as `visibleFields()` returns them. */
export type VisibleFields = readonly { readonly id: string }[];

/** An amount as every contract carries it: a whole number of pence. */
export interface FormMoney {
  readonly amountMinor: number;
  readonly currency: 'GBP';
}

/**
 * The domain package's counting and money functions. The app passes them in,
 * so the count a person sees as they type is the count the server checks.
 */
export interface FormHelpers {
  countWords(text: string): number;
  countCharacters(text: string): number;
  formatMoney(money: FormMoney): string;
  /** Each totalled column's total, keyed by column id; null when a cell is not a number or an amount. */
  tableTotals(
    field: TableFieldDefinition,
    rows: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, number | FormMoney | null>>;
}

/**
 * What a form needs to draw its questions. `formatMoney` and `tableTotals` are
 * for forms with a table question: without them a table shows no totals.
 */
export type QuestionHelpers = Pick<FormHelpers, 'countWords' | 'countCharacters'> &
  Partial<Pick<FormHelpers, 'formatMoney' | 'tableTotals'>>;

/** What an answer needs to read it. `tableTotals` is for forms with a table question: without it a table shows no totals. */
export type AnswerHelpers = Pick<FormHelpers, 'formatMoney'> &
  Partial<Pick<FormHelpers, 'tableTotals'>>;
