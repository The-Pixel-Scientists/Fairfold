// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Outcome emails (ADR 0004, ADR 0020). Each programme has one plain text
// template per outcome. A template names merge fields like
// `{{given_name}}`, and only those released to the applicant: their own
// details, the programme's and the round's, the portal link, and the award
// amount in the accepted email only. A template naming any other field, or
// with a `{{` or `}}` that is not part of one, is refused when it is saved.

import { z } from 'zod';

import type { Outcome } from './lists.ts';
import { programmeMessages, says } from './messages.ts';
import { line, paragraphs } from './text.ts';

/** Each merge field, with the words the console shows for it. */
export const mergeFields = {
  given_name: "Applicant's first name",
  organisation_name: 'Organisation name',
  programme_title: 'Programme title',
  round_title: 'Round title',
  portal_link: 'Link to the applicant portal',
  award_amount: 'Amount awarded, like £25,000',
} as const;

export type MergeField = keyof typeof mergeFields;

const released = [
  'given_name',
  'organisation_name',
  'programme_title',
  'round_title',
  'portal_link',
] as const;

/** The merge fields each outcome's template may use. */
export const mergeFieldsFor = {
  accepted: [...released, 'award_amount'],
  waitlisted: released,
  declined: released,
} as const satisfies Record<Outcome, readonly MergeField[]>;

/** `{{given_name}}`, with spaces allowed inside the braces. */
const MERGE_FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The names a text's merge fields give, in order, or null when a `{{` or `}}` is not part of one. */
export function mergeFieldsIn(text: string): string[] | null {
  const rest = text.replace(MERGE_FIELD, '');
  if (rest.includes('{{') || rest.includes('}}')) return null;
  return Array.from(text.matchAll(MERGE_FIELD), (match) => match[1] ?? '');
}

function usesOnlyFieldsFor(outcome: Outcome) {
  const allowed: ReadonlySet<string> = new Set(mergeFieldsFor[outcome]);
  return (text: string) => mergeFieldsIn(text)?.every((name) => allowed.has(name)) ?? false;
}

function emailTemplateInput(outcome: Outcome) {
  const allowed = usesOnlyFieldsFor(outcome);
  return z.strictObject({
    subject: line(150, programmeMessages.subject).refine(
      allowed,
      says(programmeMessages.mergeFields),
    ),
    body: paragraphs(5000)
      .refine((value) => value !== '', { ...says(programmeMessages.body), abort: true })
      .refine(allowed, says(programmeMessages.mergeFields)),
  });
}

/** All three templates, saved together. Each one that changed becomes a new version. */
export const emailTemplatesInputSchema = z.strictObject({
  accepted: emailTemplateInput('accepted'),
  waitlisted: emailTemplateInput('waitlisted'),
  declined: emailTemplateInput('declined'),
});

export type EmailTemplatesInput = z.infer<typeof emailTemplatesInputSchema>;

/** Version 1 of each template for every new programme, and what a send falls back to. */
export const defaultEmailTemplates = {
  accepted: {
    subject: '{{programme_title}}: we are offering you a grant',
    body: [
      'Dear {{given_name}},',
      '',
      'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
      '',
      'We are pleased to offer you a grant of {{award_amount}}.',
      '',
      'Sign in to see the offer and what happens next:',
      '{{portal_link}}',
    ].join('\n'),
  },
  waitlisted: {
    subject: '{{programme_title}}: your application is on our waiting list',
    body: [
      'Dear {{given_name}},',
      '',
      'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
      '',
      'We cannot offer you a grant yet, but your application is on our waiting list. If we can offer you a grant from this round, we will email you.',
      '',
      'Sign in to see your application:',
      '{{portal_link}}',
    ].join('\n'),
  },
  declined: {
    subject: '{{programme_title}}: the decision on your application',
    body: [
      'Dear {{given_name}},',
      '',
      'Thank you for applying to {{programme_title}} ({{round_title}}) for {{organisation_name}}.',
      '',
      'We have decided not to offer you a grant this time.',
      '',
      'Sign in to see your application:',
      '{{portal_link}}',
    ].join('\n'),
  },
} as const satisfies EmailTemplatesInput;
