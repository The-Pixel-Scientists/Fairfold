// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { defaultEmailTemplates } from '../programme/templates.ts';
import { renderTemplate, type MergeValues } from './email.ts';

const values: MergeValues = {
  givenName: 'Sam',
  organisationName: 'Northfield Community Trust',
  programmeTitle: 'Community Spaces Fund',
  roundTitle: 'Spring 2027',
  portalLink: 'https://grants.example.org/portal',
  amount: null,
};

const award = { ...values, amount: { amountMinor: 2_500_000, currency: 'GBP' } } as const;

describe('renderTemplate', () => {
  it('fills every default template', () => {
    const accepted = renderTemplate(
      { outcome: 'accepted', ...defaultEmailTemplates.accepted },
      award,
    );
    expect(accepted.subject).toBe('Community Spaces Fund: we are offering you a grant');
    expect(accepted.body).toContain('Dear Sam,');
    expect(accepted.body).toContain('a grant of £25,000.');
    expect(accepted.body).toContain('https://grants.example.org/portal');
    for (const outcome of ['waitlisted', 'declined'] as const) {
      const email = renderTemplate({ outcome, ...defaultEmailTemplates[outcome] }, values);
      expect(email.body).toContain('Northfield Community Trust');
      expect(`${email.subject}\n${email.body}`).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('fills the amount for an award only', () => {
    const body = 'You get {{ award_amount }}.';
    expect(renderTemplate({ outcome: 'accepted', subject: 'Award', body }, award).body).toBe(
      'You get £25,000.',
    );
    expect(() => renderTemplate({ outcome: 'declined', subject: 'No', body }, values)).toThrow();
    expect(() =>
      renderTemplate({ outcome: 'declined', subject: 'No', body: 'No.' }, award),
    ).toThrow();
    expect(() =>
      renderTemplate({ outcome: 'accepted', subject: 'Yes', body: 'Yes.' }, values),
    ).toThrow();
  });

  it('refuses any other merge field and stray braces', () => {
    for (const body of [
      '{{email}}',
      '{{family_name}}',
      '{{score}}',
      '{{ given_name }',
      'Dear {{given_name}}}}',
      '{{Given_Name}}',
    ]) {
      expect(
        () => renderTemplate({ outcome: 'waitlisted', subject: 'Hello', body }, values),
        body,
      ).toThrow();
    }
    expect(() =>
      renderTemplate({ outcome: 'waitlisted', subject: '{{decision}}', body: 'Hi' }, values),
    ).toThrow();
  });

  it('never fills a value in turn', () => {
    const sly = { ...values, givenName: '{{award_amount}}', organisationName: '{{portal_link}}' };
    expect(
      renderTemplate(
        { outcome: 'declined', subject: 'Hello', body: '{{given_name}} {{organisation_name}}' },
        sly,
      ).body,
    ).toBe('{{award_amount}} {{portal_link}}');
  });
});
