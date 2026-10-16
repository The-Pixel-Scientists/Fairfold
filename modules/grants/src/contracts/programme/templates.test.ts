// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { outcomeIds } from './lists.ts';
import { programmeMessages } from './messages.ts';
import {
  defaultEmailTemplates,
  emailTemplatesInputSchema,
  mergeFields,
  mergeFieldsFor,
  mergeFieldsIn,
} from './templates.ts';

/** The defaults, with one template changed. */
function withTemplate(outcome: string, change: object) {
  const templates: Record<string, object> = { ...defaultEmailTemplates };
  templates[outcome] = { ...templates[outcome], ...change };
  return templates;
}

function problems(value: unknown): Record<string, string> {
  const result = emailTemplatesInputSchema.safeParse(value);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), messageForIssue(issue)]),
  );
}

describe('merge fields', () => {
  it('are the applicant details released to them, and the award amount once accepted', () => {
    expect(Object.keys(mergeFields)).toEqual([
      'given_name',
      'organisation_name',
      'programme_title',
      'round_title',
      'portal_link',
      'award_amount',
    ]);
    expect(mergeFieldsFor.accepted).toContain('award_amount');
    expect(mergeFieldsFor.waitlisted).not.toContain('award_amount');
    expect(mergeFieldsFor.declined).not.toContain('award_amount');
  });

  it('are read from {{name}}, with spaces allowed inside the braces', () => {
    expect(mergeFieldsIn('Dear {{given_name}}, {{ round_title }} {single}')).toEqual([
      'given_name',
      'round_title',
    ]);
    expect(mergeFieldsIn('No fields here.')).toEqual([]);
    for (const text of ['{{given_name}', '{{Given_Name}}', '{{ }}', 'a }} b', '{{given-name}}']) {
      expect(mergeFieldsIn(text), text).toBeNull();
    }
  });
});

describe('email templates input', () => {
  it('takes the defaults', () => {
    expect(emailTemplatesInputSchema.parse(defaultEmailTemplates)).toEqual(defaultEmailTemplates);
  });

  it('give each default only fields released for its outcome, and the amount when accepted', () => {
    for (const outcome of outcomeIds) {
      const { subject, body } = defaultEmailTemplates[outcome];
      const used = [...(mergeFieldsIn(subject) ?? []), ...(mergeFieldsIn(body) ?? [])];
      expect(used, outcome).toContain('portal_link');
      for (const name of used) expect(mergeFieldsFor[outcome], name).toContain(name);
    }
    expect(defaultEmailTemplates.accepted.body).toContain('{{award_amount}}');
  });

  it('refuse a field that is not released, wherever it is', () => {
    const refused: [string, object, string][] = [
      ['declined', { body: 'You were offered {{award_amount}}.' }, 'declined.body'],
      ['waitlisted', { subject: 'Your score: {{score}}' }, 'waitlisted.subject'],
      ['accepted', { body: 'Dear {{email}},' }, 'accepted.body'],
      ['accepted', { body: 'Reviewer notes: {{ reviewer_comments }}' }, 'accepted.body'],
      ['accepted', { body: 'Dear {{given_name},' }, 'accepted.body'],
    ];
    for (const [outcome, change, path] of refused) {
      expect(problems(withTemplate(outcome, change)), path).toEqual({
        [path]: programmeMessages.mergeFields,
      });
    }
  });

  it('take plain text: a one-line subject, and a body with line breaks', () => {
    const body = 'Dear {{given_name}},\r\n\r\nThank you.';
    const parsed = emailTemplatesInputSchema.parse(withTemplate('declined', { body }));
    expect(parsed.declined.body).toBe('Dear {{given_name}},\n\nThank you.');
    expect(problems(withTemplate('declined', { subject: 'Decision\nBcc: x@example.org' }))).toEqual(
      { 'declined.subject': programmeMessages.hiddenCharacters },
    );
    expect(problems(withTemplate('accepted', { subject: ' ', body: '' }))).toEqual({
      'accepted.subject': programmeMessages.subject,
      'accepted.body': programmeMessages.body,
    });
  });

  it('need all three templates and nothing else', () => {
    const two = {
      accepted: defaultEmailTemplates.accepted,
      waitlisted: defaultEmailTemplates.waitlisted,
    };
    expect(emailTemplatesInputSchema.safeParse(two).success).toBe(false);
    const extra = { ...defaultEmailTemplates, rejected: defaultEmailTemplates.declined };
    expect(emailTemplatesInputSchema.safeParse(extra).success).toBe(false);
    const html = withTemplate('accepted', { html: '<p>Hi</p>' });
    expect(emailTemplatesInputSchema.safeParse(html).success).toBe(false);
  });
});
