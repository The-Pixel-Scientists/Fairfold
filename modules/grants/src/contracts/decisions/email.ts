// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fills a decision's email from its template (ADR 0004, ADR 0020), for
// sending and for the staff preview. Only the merge fields the outcome's
// template may use are filled; a template naming any other, or with a
// stray `{{` or `}}`, is refused, though saving checks the same. The amount
// is filled for an award only. Values go in as they are, in one pass, so a
// value that looks like a merge field is never filled in turn.

import { formatMoney, type Money } from '@pixel-scientists/domain/platform';

import type { Outcome } from '../programme/lists.ts';
import { mergeFieldsFor, mergeFieldsIn, type MergeField } from '../programme/templates.ts';

/** A template version as stored, with the outcome it is for. */
export interface OutcomeTemplate {
  readonly outcome: Outcome;
  readonly subject: string;
  readonly body: string;
}

/** What one applicant's email is filled with. `amount` is the award, and null unless accepted. */
export interface MergeValues {
  readonly givenName: string;
  readonly organisationName: string;
  readonly programmeTitle: string;
  readonly roundTitle: string;
  readonly portalLink: string;
  readonly amount: Money | null;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
}

const MERGE_FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

const fill: Record<MergeField, (values: MergeValues) => string | null> = {
  given_name: (values) => values.givenName,
  organisation_name: (values) => values.organisationName,
  programme_title: (values) => values.programmeTitle,
  round_title: (values) => values.roundTitle,
  portal_link: (values) => values.portalLink,
  award_amount: (values) => (values.amount === null ? null : formatMoney(values.amount)),
};

/** Throws if the template or the values break the rules above. */
export function renderTemplate(template: OutcomeTemplate, values: MergeValues): RenderedEmail {
  if ((template.outcome === 'accepted') !== (values.amount !== null)) {
    throw new Error('An accepted decision needs its amount, and no other outcome has one.');
  }
  const allowed: ReadonlySet<string> = new Set(mergeFieldsFor[template.outcome]);
  const render = (text: string) => {
    if (mergeFieldsIn(text) === null) throw new Error('The template has a stray {{ or }}.');
    return text.replace(MERGE_FIELD, (_match, name: string) => {
      const value = allowed.has(name) ? fill[name as MergeField](values) : null;
      if (value === null) throw new Error(`The ${template.outcome} email cannot use {{${name}}}.`);
      return value;
    });
  };
  return { subject: render(template.subject), body: render(template.body) };
}
