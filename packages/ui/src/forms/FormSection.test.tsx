// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { question, SectionHarness } from '../../test/forms.tsx';

const options = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
];

describe('FormSection', () => {
  it('shows the section heading, its introduction and the questions', () => {
    render(
      <SectionHarness
        headingLevel="h1"
        fields={[question({ id: 'f_name', type: 'short_text', label: 'Organisation name' })]}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'About you' })).toBeTruthy();
    expect(screen.getByText('Tell us about you.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Organisation name/ })).toBeTruthy();
  });

  it('shows only the fields that are visible, and a field comes and goes with the list', () => {
    const fields = [
      question({ id: 'f_one', type: 'short_text', label: 'First' }),
      question({ id: 'f_two', type: 'short_text', label: 'Second' }),
    ];
    const { rerender } = render(<SectionHarness fields={fields} visible={[{ id: 'f_one' }]} />);

    expect(screen.getByRole('textbox', { name: /First/ })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Second/ })).toBeNull();

    rerender(<SectionHarness fields={fields} visible={fields} />);
    expect(screen.getByRole('textbox', { name: /Second/ })).toBeTruthy();
  });

  it('says in words whether a question is required or optional', () => {
    render(
      <SectionHarness
        fields={[
          question({ id: 'f_one', type: 'short_text', label: 'Name', required: true }),
          question({ id: 'f_two', type: 'short_text', label: 'Nickname' }),
          question({
            id: 'f_three',
            type: 'single_choice',
            label: 'Pick',
            required: true,
            options,
          }),
          question({ id: 'f_four', type: 'date', label: 'Start', required: true }),
        ]}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Nickname (optional)' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Pick (required)' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Start (required)' })).toBeTruthy();
  });

  it('ties the hint to the control with aria-describedby', () => {
    render(
      <SectionHarness
        fields={[
          question({
            id: 'f_name',
            type: 'short_text',
            label: 'Name',
            hint: 'As on your accounts.',
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: /Name/, description: 'As on your accounts.' }),
    ).toBeTruthy();
  });

  it('shows content blocks as paragraphs of text, never as markup', () => {
    render(
      <SectionHarness
        fields={[
          {
            id: 'f_intro',
            type: 'content',
            body: 'First paragraph.\n\nSecond <b>paragraph</b>.',
          },
        ]}
      />,
    );

    expect(screen.getByText('First paragraph.').tagName).toBe('P');
    expect(screen.getByText('Second <b>paragraph</b>.')).toBeTruthy();
  });

  describe('errors', () => {
    const fields = [
      question({
        id: 'f_name',
        type: 'short_text',
        label: 'Name',
        required: true,
        hint: 'In full.',
      }),
      question({ id: 'f_region', type: 'single_choice', label: 'Region', required: true, options }),
      question({ id: 'f_address', type: 'uk_address', label: 'Address' }),
    ];
    const problems = [
      { field: 'f_name', message: 'Enter an answer to this question.' },
      { field: 'f_region', message: 'Choose an answer to this question.' },
      { field: 'f_address.postcode', message: 'Enter a real postcode, like SW1A 1AA.' },
    ];

    it('shows each message beside its field, tied to it and marked invalid', () => {
      render(<SectionHarness fields={fields} problems={problems} />);

      const name = screen.getByRole('textbox', {
        name: /Name/,
        description: 'In full. Error: Enter an answer to this question.',
      });
      expect(name.getAttribute('aria-invalid')).toBe('true');
      const group = screen.getByRole('group', { name: /Region/ });
      expect(group.getAttribute('aria-describedby')).toBe('f_region-error');
      expect(screen.getByText('Choose an answer to this question.')).toBeTruthy();
    });

    it('shows no summary until the person has asked to continue', () => {
      render(<SectionHarness fields={fields} problems={problems} />);

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('summarises the problems, each linking to its control, and moves focus to the summary', async () => {
      const user = userEvent.setup();
      render(<SectionHarness fields={fields} problems={problems} attempt={1} />);

      const summary = screen.getByRole('alert', { name: 'There is a problem' });
      expect(document.activeElement).toBe(summary);
      const links = within(summary).getAllByRole('link');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Enter an answer to this question.', '#f_name'],
        ['Choose an answer to this question.', '#f_region'],
        ['Enter a real postcode, like SW1A 1AA.', '#f_address-postcode'],
      ]);

      await user.click(links[1] as HTMLElement);
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'North' }));
      await user.click(links[2] as HTMLElement);
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Postcode' }));
    });

    it('leaves out problems about fields that are not shown', () => {
      render(
        <SectionHarness
          fields={fields}
          visible={[{ id: 'f_name' }]}
          problems={problems}
          attempt={1}
        />,
      );

      expect(within(screen.getByRole('alert')).getAllByRole('link')).toHaveLength(1);
    });

    it('shows no summary when the problems have been fixed', () => {
      render(<SectionHarness fields={fields} problems={[]} attempt={2} />);

      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
