// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turns the selected applications into the sections a renderer takes: one
// section per application, headed by its position in the pack and nothing
// that names the applicant, then a table of its fixed details, then the
// template's body with its merge fields filled. The model is plain text only
// (the platform's model check refuses anything else), and what each person
// may see was decided in read.ts before it gets here.
//
// Every value is set as text: control and format characters become spaces
// and a long value is cut, so nothing reorders, hides or breaks the layout.
// A page break or logo block in a template is left out, since the pack's
// pages are the renderer's. A field the requester may not have prints as
// NOT_SHOWN, and one with no answer as a fixed phrase.

import {
  documentFields,
  NOT_SHOWN,
  type TemplateBlock,
  type TemplateVersion,
} from '@pixel-scientists/domain/documents';
import { fieldsOf, type FormField } from '@pixel-scientists/domain/forms';
import { formatMoney, moneySchema } from '@pixel-scientists/domain/platform';

import { outcomes } from '../../contracts/index.ts';
import {
  allowedMergeFields,
  showsDecision,
  showsOrganisation,
  type Requester,
  type SelectedApplication,
} from './read.ts';

export type BoardPackBlock =
  | { readonly type: 'heading'; readonly level: number; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: string[] }
  | { readonly type: 'table'; readonly header: string[]; readonly rows: string[][] };

export interface BoardPackModel {
  readonly title: string;
  readonly sections: { readonly heading: string; readonly blocks: BoardPackBlock[] }[];
}

const NO_ANSWER = 'No answer';
const MAX_TEXT = 20_000;

const STATUSES: Readonly<Record<string, string>> = {
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
};

/** Plain text: hidden and control characters become spaces, and the length is capped. */
export function plain(value: string): string {
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function labelOf(field: FormField, value: unknown): string {
  const options = 'options' in field ? field.options : [];
  return options.find((option) => option.value === value)?.label ?? String(value);
}

function answerText(field: FormField, value: unknown): string {
  if (value === null || value === undefined) return NO_ANSWER;
  if (typeof value === 'string') return plain(labelOf(field, value)) || NO_ANSWER;
  if (typeof value === 'number') return value.toLocaleString('en-GB');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (field.type === 'file') return `${String(value.length)} files attached`;
    if (field.type === 'table') return `${String(value.length)} rows`;
    const labels = value.map((item) => labelOf(field, item)).join('; ');
    return plain(labels) || NO_ANSWER;
  }
  const money = moneySchema.safeParse(value);
  if (money.success) return formatMoney(money.data);
  const address = Object.values(value as Record<string, unknown>)
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(', ');
  return plain(address) || NO_ANSWER;
}

const longDate = (value: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone }).format(value);

function details(
  requester: Requester,
  application: SelectedApplication,
  organisation: string | undefined,
  timeZone: string,
): string[][] {
  const rows = [
    ['Programme', plain(application.programmeTitle)],
    ['Round', plain(application.roundTitle)],
    ['Status', STATUSES[application.status] ?? 'Not submitted'],
  ];
  if (application.submittedAt !== null) {
    rows.push(['Submitted', longDate(application.submittedAt, timeZone)]);
  }
  if (showsOrganisation(requester) && organisation !== undefined) {
    rows.push(['Organisation', plain(organisation)]);
  }
  if (showsDecision(requester, application)) {
    const { outcome, amountMinor } = application.decision;
    rows.push(['Decision', outcomes[outcome]]);
    if (amountMinor !== null) {
      rows.push(['Amount', formatMoney({ amountMinor: Number(amountMinor), currency: 'GBP' })]);
    }
  }
  return rows;
}

type Line = Extract<TemplateBlock, { type: 'paragraph' }>['content'];

function body(
  template: TemplateVersion,
  requester: Requester,
  application: SelectedApplication,
): BoardPackBlock[] {
  const fields = new Map(fieldsOf(application.definition).map((field) => [field.id, field]));
  const allowed = allowedMergeFields(template, requester, application);
  const { values } = documentFields(
    template,
    application.definition,
    application.answers,
    requester.audience,
    allowed,
  );
  const line = (parts: Line): string =>
    plain(
      parts
        .map((part) => {
          if ('text' in part) return part.text;
          const field = fields.get(part.field);
          return field === undefined || !allowed.includes(part.field)
            ? NOT_SHOWN
            : answerText(field, values[part.field]);
        })
        .join(''),
    );
  return template.body.flatMap((block): BoardPackBlock[] => {
    switch (block.type) {
      case 'heading':
        // The title is the H1 and each application the H2, so a template's headings start at H3.
        return [{ type: 'heading', level: block.level + 2, text: plain(block.text) }];
      case 'paragraph':
        return [{ type: 'paragraph', text: line(block.content) }];
      case 'list':
        return [{ type: 'list', ordered: block.ordered, items: block.items.map(line) }];
      case 'table':
        return [
          {
            type: 'table',
            header: block.header.map(plain),
            rows: block.rows.map((row) => row.map(line)),
          },
        ];
      default:
        return [];
    }
  });
}

/**
 * The model of the pack. `organisations` holds each application's organisation as submitted
 * (its snapshot), by application id; a blind reviewer's pack ignores it.
 */
export function buildModel(
  template: TemplateVersion,
  requester: Requester,
  applications: readonly SelectedApplication[],
  organisations: ReadonlyMap<string, string>,
  timeZone: string,
): BoardPackModel {
  return {
    title: plain(template.title),
    sections: applications.map((application, index) => ({
      heading: `Application ${String(index + 1)}`,
      blocks: [
        {
          type: 'table',
          header: ['Detail', 'Value'],
          rows: details(requester, application, organisations.get(application.id), timeZone),
        },
        ...body(template, requester, application),
      ],
    })),
  };
}
