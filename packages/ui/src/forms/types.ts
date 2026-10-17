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
  /** Files the applicant attaches. The answer is the ids of the files attached, which the server adds. */
  | (QuestionBase & {
      readonly type: 'file';
      /** The types the question takes, as the platform names them, such as `application/pdf`. */
      readonly allowedTypes: readonly string[];
      /** In bytes. */
      readonly maxBytes: number;
      readonly maxFiles: number;
    })
  /** Text for the applicant to read. It takes no answer. */
  | { readonly id: string; readonly type: 'content'; readonly body: string };

/** A field that takes an answer. */
export type QuestionDefinition = Exclude<FormFieldDefinition, { readonly type: 'content' }>;

export type TableFieldDefinition = Extract<QuestionDefinition, { readonly type: 'table' }>;

export type FileFieldDefinition = Extract<QuestionDefinition, { readonly type: 'file' }>;

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

/** The domain package's file functions, for forms with a file question. */
export interface FileHelpers {
  /** Each file type in words, keyed by the type, such as "PDF". */
  readonly fileTypeLabels: Readonly<Record<string, string>>;
  /** The accepted type a file's bytes show, or null when they match none. */
  sniffFileType(bytes: Uint8Array): string | null;
  /** The words for a file the question refuses, or undefined when it takes it. `type` is what `sniffFileType` found. */
  checkFile(
    field: FileFieldDefinition,
    file: { readonly bytes: number; readonly type: string | null },
  ): string | undefined;
}

/** A file attached to a question, as the attachment routes list it. */
export interface AttachedFile {
  readonly id: string;
  /** The question it answers. */
  readonly fieldId: string;
  readonly name: string;
  /** The type found in its bytes, such as `application/pdf`. */
  readonly type: string;
  /** In bytes. */
  readonly bytes: number;
}

/** What a form's file questions need from the app, which sends and removes the files. */
export interface FormFiles {
  /** Every file attached to the form, each naming its question. */
  readonly files: readonly AttachedFile[];
  /** Shows the files for download only, as for an application that can no longer change. */
  readonly readOnly?: boolean;
  /** Where a file downloads from. Build it from the id: a name never goes in an address. */
  hrefFor(id: string): string;
  /**
   * Sends one file to a question. `onProgress` takes the bytes sent and the
   * total, as the domain package's `upload()` reports them. Resolve once the
   * file is in `files`; reject with the API's problem when it is refused.
   */
  onUpload(
    fieldId: string,
    file: File,
    onProgress: (sent: number, total: number) => void,
  ): Promise<unknown>;
  /** Called with the question and the id of the file whose "Remove" button was pressed. */
  onRemove(fieldId: string, id: string): void;
}

/**
 * What a form needs to draw its questions. `formatMoney` and `tableTotals` are
 * for forms with a table question: without them a table shows no totals. The
 * file helpers are for forms with a file question: without the two checks the
 * browser sends every file and the server decides, and without the labels a
 * type shows as its own name.
 */
export type QuestionHelpers = Pick<FormHelpers, 'countWords' | 'countCharacters'> &
  Partial<Pick<FormHelpers, 'formatMoney' | 'tableTotals'>> &
  Partial<FileHelpers>;

/**
 * What an answer needs to read it. `tableTotals` is for forms with a table
 * question: without it a table shows no totals. `fileTypeLabels` is for forms
 * with a file question: without it a type shows as its own name.
 */
export type AnswerHelpers = Pick<FormHelpers, 'formatMoney'> &
  Partial<Pick<FormHelpers, 'tableTotals'>> &
  Partial<Pick<FileHelpers, 'fileTypeLabels'>>;
