// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { question, SectionHarness } from '../../test/forms.tsx';

const options = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
];

describe('Question', () => {
  describe('text', () => {
    it('takes short text and gives null when it is cleared', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[question({ id: 'f_name', type: 'short_text', label: 'Name' })]}
        />,
      );

      await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Ab');
      expect(onAnswer).toHaveBeenLastCalledWith('f_name', 'Ab');
      await user.clear(screen.getByRole('textbox', { name: /Name/ }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_name', null);
    });

    it('takes long text in a text area and keeps line breaks', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[question({ id: 'f_story', type: 'long_text', label: 'Story' })]}
        />,
      );

      await user.type(screen.getByRole('textbox', { name: /Story/ }), 'One{Enter}Two');
      expect(onAnswer).toHaveBeenLastCalledWith('f_story', 'One\nTwo');
    });

    it('shows no count when the field has no limit', () => {
      render(
        <SectionHarness
          fields={[question({ id: 'f_story', type: 'long_text', label: 'Story' })]}
        />,
      );

      expect(screen.queryByText(/You have/)).toBeNull();
    });

    it('counts words as the person types, and says when the answer is over', async () => {
      const user = userEvent.setup();
      render(
        <SectionHarness
          fields={[question({ id: 'f_story', type: 'long_text', label: 'Story', maxWords: 3 })]}
        />,
      );
      const box = screen.getByRole('textbox', {
        name: /Story/,
        description: 'You have 3 words left',
      });

      await user.type(box, 'one two');
      expect(box.getAttribute('aria-describedby')).toContain('f_story-count');
      expect(screen.getAllByText('You have 1 word left').length).toBeGreaterThan(0);
      await user.type(box, ' three');
      expect(screen.getAllByText('You have 0 words left').length).toBeGreaterThan(0);
      await user.type(box, ' four five');
      expect(screen.getAllByText('You have 2 words too many').length).toBeGreaterThan(0);
      await user.type(box, ' six');
      expect(screen.getAllByText('You have 3 words too many').length).toBeGreaterThan(0);
    });

    it('counts characters when the limit is in characters', async () => {
      const user = userEvent.setup();
      render(
        <SectionHarness
          fields={[question({ id: 'f_code', type: 'short_text', label: 'Code', maxCharacters: 4 })]}
        />,
      );

      await user.type(screen.getByRole('textbox', { name: /Code/ }), 'abcde');
      expect(screen.getAllByText('You have 1 character too many').length).toBeGreaterThan(0);
    });
  });

  describe('numbers', () => {
    it('takes a number as text and gives a number', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[
            question({ id: 'f_people', type: 'number', label: 'People', wholeNumber: true }),
          ]}
        />,
      );
      const box = screen.getByRole('textbox', { name: /People/ });

      await user.type(box, '1,250');
      expect(onAnswer).toHaveBeenLastCalledWith('f_people', 1250);
      expect(box.getAttribute('inputmode')).toBe('numeric');
    });

    it('keeps what is typed while it is not yet a number, and passes it on as typed', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[
            question({ id: 'f_people', type: 'number', label: 'People', wholeNumber: false }),
          ]}
        />,
      );
      const box = screen.getByRole<HTMLInputElement>('textbox', { name: /People/ });

      await user.type(box, '12.');
      expect(box.value).toBe('12.');
      expect(onAnswer).toHaveBeenLastCalledWith('f_people', '12.');
      await user.type(box, '5');
      expect(onAnswer).toHaveBeenLastCalledWith('f_people', 12.5);
      await user.clear(box);
      expect(onAnswer).toHaveBeenLastCalledWith('f_people', null);
    });

    it('takes an amount in pounds and gives pence', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[
            question({ id: 'f_amount', type: 'currency', label: 'Amount', currency: 'GBP' }),
          ]}
        />,
      );
      const box = screen.getByRole('textbox', { name: /Amount/, description: 'Amount in pounds' });

      await user.type(box, '£25,000');
      expect(onAnswer).toHaveBeenLastCalledWith('f_amount', {
        amountMinor: 2_500_000,
        currency: 'GBP',
      });
      await user.clear(box);
      await user.type(box, '12.5');
      expect(onAnswer).toHaveBeenLastCalledWith('f_amount', { amountMinor: 1250, currency: 'GBP' });
      await user.clear(box);
      await user.type(box, '12.345');
      expect(onAnswer).toHaveBeenLastCalledWith('f_amount', '12.345');
    });

    it('shows a saved amount in pounds', () => {
      render(
        <SectionHarness
          answers={{ f_amount: { amountMinor: 1_250_050, currency: 'GBP' } }}
          fields={[
            question({ id: 'f_amount', type: 'currency', label: 'Amount', currency: 'GBP' }),
          ]}
        />,
      );

      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Amount/ }).value).toBe(
        '12500.50',
      );
    });
  });

  describe('dates', () => {
    const date = [question({ id: 'f_start', type: 'date', label: 'Start date' })];

    it('is a group of three labelled boxes, with an example', () => {
      render(<SectionHarness fields={date} />);

      const group = screen.getByRole('group', { name: /Start date/ });
      expect(within(group).getByRole('textbox', { name: 'Day' }).id).toBe('f_start');
      expect(within(group).getByRole('textbox', { name: 'Month' }).id).toBe('f_start-month');
      expect(within(group).getByRole('textbox', { name: 'Year' }).id).toBe('f_start-year');
      expect(group.getAttribute('aria-describedby')).toBe('f_start-hint');
      expect(screen.getByText('For example, 27 3 2027')).toBeTruthy();
    });

    it('gives a date once the three boxes make one, and no answer when they are empty', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(<SectionHarness fields={date} onAnswer={onAnswer} />);

      await user.type(screen.getByRole('textbox', { name: 'Day' }), '1');
      await user.type(screen.getByRole('textbox', { name: 'Month' }), '4');
      expect(onAnswer).toHaveBeenLastCalledWith('f_start', '-4-1');
      await user.type(screen.getByRole('textbox', { name: 'Year' }), '2027');
      expect(onAnswer).toHaveBeenLastCalledWith('f_start', '2027-04-01');
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Day' }).value).toBe('1');

      await user.clear(screen.getByRole('textbox', { name: 'Day' }));
      await user.clear(screen.getByRole('textbox', { name: 'Month' }));
      await user.clear(screen.getByRole('textbox', { name: 'Year' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_start', null);
    });

    it('fills the boxes from a saved date', () => {
      render(<SectionHarness fields={date} answers={{ f_start: '2027-03-27' }} />);

      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Day' }).value).toBe('27');
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Month' }).value).toBe('3');
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Year' }).value).toBe('2027');
    });

    it('marks all three boxes when the date is wrong', () => {
      render(
        <SectionHarness
          fields={date}
          problems={[{ field: 'f_start', message: 'Enter a real date, like 27 March 2027.' }]}
        />,
      );

      for (const name of ['Day', 'Month', 'Year']) {
        expect(screen.getByRole('textbox', { name }).getAttribute('aria-invalid')).toBe('true');
      }
    });
  });

  describe('email, phone and web address', () => {
    it('uses the input types and autofill hints that suit each', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[
            question({ id: 'f_email', type: 'email', label: 'Email' }),
            question({ id: 'f_phone', type: 'phone', label: 'Phone' }),
            question({ id: 'f_site', type: 'url', label: 'Website' }),
          ]}
        />,
      );

      const email = screen.getByRole('textbox', { name: /Email/ });
      expect(email.getAttribute('type')).toBe('email');
      expect(email.getAttribute('autocomplete')).toBe('email');
      expect(screen.getByRole('textbox', { name: /Phone/ }).getAttribute('type')).toBe('tel');
      expect(screen.getByRole('textbox', { name: /Website/ }).getAttribute('type')).toBe('url');

      await user.type(email, 'a@b.org');
      expect(onAnswer).toHaveBeenLastCalledWith('f_email', 'a@b.org');
    });
  });

  describe('choices', () => {
    it('shows a single choice as radio buttons in a group, and gives the value', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[question({ id: 'f_region', type: 'single_choice', label: 'Region', options })]}
        />,
      );

      const group = screen.getByRole('group', { name: /Region/ });
      expect(
        within(group)
          .getAllByRole('radio')
          .map((radio) => radio.id),
      ).toEqual(['f_region', 'f_region-1', 'f_region-2']);
      await user.click(within(group).getByRole('radio', { name: 'South' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_region', 'south');
    });

    it('shows yes or no as radio buttons and gives true or false', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[question({ id: 'f_charity', type: 'yes_no', label: 'Are you a charity?' })]}
        />,
      );

      const group = screen.getByRole('group', { name: /Are you a charity/ });
      await user.click(within(group).getByRole('radio', { name: 'Yes' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_charity', true);
      await user.click(within(group).getByRole('radio', { name: 'No' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_charity', false);
    });

    it('shows a saved answer to yes or no, including no', () => {
      render(
        <SectionHarness
          answers={{ f_charity: false }}
          fields={[question({ id: 'f_charity', type: 'yes_no', label: 'Are you a charity?' })]}
        />,
      );

      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'No' }).checked).toBe(true);
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Yes' }).checked).toBe(false);
    });

    it('shows multiple choice as checkboxes, gives the ticked values in order, and null when none', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[
            question({
              id: 'f_where',
              type: 'multiple_choice',
              label: 'Where',
              options,
              maxSelections: 2,
            }),
          ]}
        />,
      );

      const group = screen.getByRole('group', { name: /Where/ });
      expect(group.getAttribute('aria-describedby')).toBe('f_where-hint');
      expect(screen.getByText('Choose up to 2.')).toBeTruthy();
      await user.click(within(group).getByRole('checkbox', { name: 'East' }));
      await user.click(within(group).getByRole('checkbox', { name: 'North' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_where', ['north', 'east']);
      await user.click(within(group).getByRole('checkbox', { name: 'North' }));
      await user.click(within(group).getByRole('checkbox', { name: 'East' }));
      expect(onAnswer).toHaveBeenLastCalledWith('f_where', null);
    });

    it('says to choose all that apply when there are no limits', () => {
      render(
        <SectionHarness
          fields={[question({ id: 'f_where', type: 'multiple_choice', label: 'Where', options })]}
        />,
      );

      expect(screen.getByText('Choose all that apply.')).toBeTruthy();
    });

    it('shows a dropdown as a native select with a first choice that clears it', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(
        <SectionHarness
          onAnswer={onAnswer}
          fields={[question({ id: 'f_region', type: 'dropdown', label: 'Region', options })]}
        />,
      );

      const select = screen.getByRole<HTMLSelectElement>('combobox', { name: /Region/ });
      expect(select.tagName).toBe('SELECT');
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Choose an option', 'North', 'South', 'East']);
      await user.selectOptions(select, 'South');
      expect(onAnswer).toHaveBeenLastCalledWith('f_region', 'south');
      await user.selectOptions(select, 'Choose an option');
      expect(onAnswer).toHaveBeenLastCalledWith('f_region', null);
    });
  });

  describe('addresses', () => {
    const address = [question({ id: 'f_address', type: 'uk_address', label: 'Address' })];

    it('is a labelled group of boxes, with the optional ones marked', () => {
      render(<SectionHarness fields={address} />);

      const group = screen.getByRole('group', { name: /Address/ });
      const labels = within(group)
        .getAllByRole('textbox')
        .map((box) => [box.id, box.getAttribute('autocomplete')]);
      expect(labels).toEqual([
        ['f_address', 'address-line1'],
        ['f_address-line2', 'address-line2'],
        ['f_address-town', 'address-level2'],
        ['f_address-county', 'address-level1'],
        ['f_address-postcode', 'postal-code'],
      ]);
      expect(
        within(group).getByRole('textbox', { name: 'Address line 2 (optional)' }),
      ).toBeTruthy();
      expect(within(group).getByRole('textbox', { name: 'County (optional)' })).toBeTruthy();
      expect(within(group).getByRole('textbox', { name: 'Postcode' })).toBeTruthy();
    });

    it('gives the address, leaving out optional boxes that are empty, and null when all are', async () => {
      const user = userEvent.setup();
      const onAnswer = vi.fn();
      render(<SectionHarness fields={address} onAnswer={onAnswer} />);

      await user.type(screen.getByRole('textbox', { name: 'Address line 1' }), '1 High Street');
      await user.type(screen.getByRole('textbox', { name: 'Town or city' }), 'Northfield');
      await user.type(screen.getByRole('textbox', { name: 'Postcode' }), 'NF1 1AA');
      expect(onAnswer).toHaveBeenLastCalledWith('f_address', {
        line1: '1 High Street',
        town: 'Northfield',
        postcode: 'NF1 1AA',
      });
      await user.type(screen.getByRole('textbox', { name: /County/ }), 'Shire');
      expect(onAnswer).toHaveBeenLastCalledWith('f_address', {
        line1: '1 High Street',
        town: 'Northfield',
        county: 'Shire',
        postcode: 'NF1 1AA',
      });

      for (const name of ['Address line 1', 'Town or city', 'Postcode', /County/]) {
        await user.clear(screen.getByRole('textbox', { name }));
      }
      expect(onAnswer).toHaveBeenLastCalledWith('f_address', null);
    });

    it('shows a problem with one box beside it, and one with the whole address on the group', () => {
      render(
        <SectionHarness
          fields={address}
          problems={[
            { field: 'f_address.town', message: 'Enter the town or city.' },
            { field: 'f_address.postcode', message: 'Enter a real postcode, like SW1A 1AA.' },
          ]}
        />,
      );

      const town = screen.getByRole('textbox', { name: 'Town or city' });
      expect(town.getAttribute('aria-invalid')).toBe('true');
      expect(town.getAttribute('aria-describedby')).toBe('f_address-town-error');
      expect(
        screen.getByRole('textbox', { name: 'Address line 1' }).getAttribute('aria-invalid'),
      ).toBeNull();
      expect(screen.getByText('Enter a real postcode, like SW1A 1AA.')).toBeTruthy();
    });
  });
});
