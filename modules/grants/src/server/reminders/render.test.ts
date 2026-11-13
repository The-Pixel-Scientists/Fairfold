// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { renderReminder } from './render.ts';

const values = {
  given_name: 'Ada',
  organisation_name: 'Northfield Allotment Society',
  programme_title: 'Community Growing Fund',
  round_title: 'Spring round',
  portal_link: 'https://portal.example.org',
  closing_time: '12pm UK time on 15 January 2027',
};

describe('filling a reminder', () => {
  it('fills the fields a draft reminder may use', () => {
    expect(
      renderReminder(
        'draft_closing',
        {
          subject: '{{round_title}} closes soon',
          body: 'Hello {{ given_name }}. {{organisation_name}} closes {{closing_time}}. {{portal_link}}',
        },
        values,
      ),
    ).toEqual({
      subject: 'Spring round closes soon',
      body: 'Hello Ada. Northfield Allotment Society closes 12pm UK time on 15 January 2027. https://portal.example.org',
    });
  });

  it('refuses a field the kind may not use, an unknown field and a stray brace', () => {
    const template = (body: string) => ({ subject: 'Reminder', body });
    expect(() => renderReminder('review_overdue', template('{{closing_time}}'), values)).toThrow();
    expect(() => renderReminder('review_overdue', template('{{award_amount}}'), values)).toThrow();
    expect(() => renderReminder('draft_closing', template('Hello {{'), values)).toThrow();
  });

  it('fills a value that looks like a merge field once, and does not fill it again', () => {
    expect(
      renderReminder(
        'review_overdue',
        { subject: 'Reminder', body: '{{given_name}}' },
        { ...values, given_name: '{{round_title}}' },
      ).body,
    ).toBe('{{round_title}}');
  });
});
