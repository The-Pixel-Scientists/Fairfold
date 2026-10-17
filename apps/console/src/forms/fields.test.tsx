// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setUpConsoleTests } from '../testing/render.tsx';
import {
  actionButton,
  editor,
  openDraft,
  questionButton,
  saves,
  savedDefinition,
  sectionButton,
} from './builder.ts';
import { draft, stored } from './fixtures.ts';

setUpConsoleTests();

const ORG = 'Organisation name';
const CHARITY = 'Is your organisation a registered charity?';
const NUMBER = 'Registered charity number';
const STORY = 'What will you do with the money?';
const SPEND = 'What will the money pay for?';

/** Opens a question, in its section. */
async function select(user: ReturnType<typeof userEvent.setup>, label: string) {
  if (label === STORY || label === SPEND) await user.click(sectionButton('Your project'));
  await user.click(questionButton(label));
}

/** Saves the draft and gives the question with this id from what was sent. */
async function saved(
  user: ReturnType<typeof userEvent.setup>,
  sent: Awaited<ReturnType<typeof openDraft>>,
  id: string,
) {
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/^Saved /);
  return savedDefinition(sent)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === id);
}

describe('the settings every question has', () => {
  it('are its words, whether it is required, and who sees the answer', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, STORY);

    const panel = within(editor());
    expect(panel.getByRole('textbox', { name: 'Question' })).toHaveProperty('value', STORY);
    expect(panel.getByRole('textbox', { name: /^Hint/ })).toHaveProperty(
      'value',
      'Say who it is for.',
    );
    expect(panel.getByRole('combobox', { name: 'Type' })).toHaveProperty('value', 'long_text');
    expect(
      panel.getByRole<HTMLInputElement>('checkbox', {
        name: 'Applicants must answer this question',
      }).checked,
    ).toBe(true);
    expect(panel.getByRole('combobox', { name: 'Who sees the answer' })).toHaveProperty(
      'value',
      'everyone',
    );
  });

  it('are changed in the question, and in the list beside it', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, STORY);
    const panel = within(editor());

    await user.type(panel.getByRole('textbox', { name: 'Question' }), ' Be specific.');
    await user.click(panel.getByRole('checkbox', { name: 'Applicants must answer this question' }));

    expect(questionButton('Be specific.').textContent).toContain('Optional');
  });

  it('keep the hint out of the form when it is cleared', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, STORY);

    await user.clear(within(editor()).getByRole('textbox', { name: /^Hint/ }));

    expect(await saved(user, sent, 'f_story')).not.toHaveProperty('hint');
  });

  it('are changed to another type, which keeps its words', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, ORG);

    await user.selectOptions(within(editor()).getByRole('combobox', { name: 'Type' }), 'Date');

    expect(questionButton(ORG).textContent).toContain('Date');
    expect(await saved(user, sent, 'f_name')).toMatchObject({
      type: 'date',
      label: ORG,
      identity: true,
      audiences: ['applicant', 'staff'],
    });
  });

  it('say what an applicant does for a type that has no settings of its own', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, ORG);

    await user.selectOptions(
      within(editor()).getByRole('combobox', { name: 'Type' }),
      'Email address',
    );

    expect(
      within(editor()).getByText(
        'Applicants enter an email address, which is checked for its format.',
      ),
    ).toBeTruthy();
  });
});

describe('the limits of a text question', () => {
  it('are whole numbers of words and characters, or none', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, STORY);
    const words = within(editor()).getByRole('textbox', { name: /^Word limit/ });
    const characters = within(editor()).getByRole('textbox', { name: /^Character limit/ });
    expect(words).toHaveProperty('value', '300');
    expect(characters).toHaveProperty('value', '');

    await user.clear(words);
    await user.type(words, '1a5b0');
    await user.type(characters, '2000');

    expect(words).toHaveProperty('value', '150');
    expect(await saved(user, sent, 'f_story')).toMatchObject({
      maxWords: 150,
      maxCharacters: 2000,
    });
  });

  it('are left out when the boxes are empty', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, STORY);

    await user.clear(within(editor()).getByRole('textbox', { name: /^Word limit/ }));

    expect(await saved(user, sent, 'f_story')).not.toHaveProperty('maxWords');
  });
});

describe('who sees an answer', () => {
  it('is chosen in words, and the list beside it says who is kept from it', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, STORY);
    const who = within(editor()).getByRole('combobox', { name: 'Who sees the answer' });

    await user.selectOptions(who, 'Staff only, not reviewers');
    expect(questionButton(STORY).textContent).toContain('Hidden from reviewers');
    expect(
      within(editor()).getByText(/The applicant always sees their own answer. Reviewers never see/),
    ).toBeTruthy();
    await user.selectOptions(who, 'Only in totals');

    expect(questionButton(STORY).textContent).toContain('Only in totals');
    expect(await saved(user, sent, 'f_story')).toMatchObject({ audiences: 'aggregate_only' });
  });

  it('keeps identity answers from blind reviewers', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, STORY);

    await user.click(
      within(editor()).getByRole('checkbox', { name: 'Identity field: hide from blind reviewers' }),
    );

    expect(questionButton(STORY).textContent).toContain('Hidden from blind reviewers');
    expect(await saved(user, sent, 'f_story')).toMatchObject({ identity: true });
  });
});

describe('the choices of a question', () => {
  const choice = (n: number) =>
    within(editor()).getByRole('textbox', { name: `Choice ${String(n)}` });

  it('are listed, and added with the cursor in the new one', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, SPEND);
    expect(choice(1)).toHaveProperty('value', 'Building work');
    expect(choice(2)).toHaveProperty('value', 'Training');

    await user.click(within(editor()).getByRole('button', { name: 'Add choice' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(choice(3));
    });
    await user.type(choice(3), 'Equipment');
    const field = await saved(user, sent, 'f_spend');
    expect(
      (field?.['options'] as { label: string; value: string }[]).map((item) => item.label),
    ).toEqual(['Building work', 'Training', 'Equipment']);
    expect((field?.['options'] as { value: string }[])[0]?.value).toBe('building');
    expect((field?.['options'] as { value: string }[])[2]?.value).toMatch(/^o_[a-z0-9]{8}$/);
  });

  it('keep their values when their words change', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, SPEND);

    await user.type(choice(1), ' and repairs');

    const field = await saved(user, sent, 'f_spend');
    expect(field?.['options']).toEqual([
      { value: 'building', label: 'Building work and repairs' },
      { value: 'training', label: 'Training' },
    ]);
  });

  it('are removed, with focus on the button to add one, and a question keeps two', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, SPEND);
    await user.click(within(editor()).getByRole('button', { name: 'Add choice' }));
    await user.click(actionButton('Remove', 'choice 3'));

    expect(within(editor()).queryByRole('textbox', { name: 'Choice 3' })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(editor()).getByRole('button', { name: 'Add choice' }),
      );
    });
    const last = actionButton('Remove', 'choice 2');
    expect(last.getAttribute('aria-disabled')).toBe('true');
    await user.click(last);
    expect(choice(2)).toBeTruthy();
    expect(within(editor()).getByText('A question needs at least 2 choices.')).toBeTruthy();
  });

  it('start as two blank choices when a question becomes a choice question', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, ORG);

    await user.selectOptions(
      within(editor()).getByRole('combobox', { name: 'Type' }),
      'Choose one',
    );

    expect(choice(1)).toHaveProperty('value', '');
    expect(choice(2)).toHaveProperty('value', '');
  });

  it('can be limited when applicants may tick several', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, SPEND);
    expect(within(editor()).queryByRole('textbox', { name: /Fewest choices/ })).toBeNull();

    await user.selectOptions(
      within(editor()).getByRole('combobox', { name: 'Type' }),
      'Choose several',
    );
    await user.type(within(editor()).getByRole('textbox', { name: /Fewest choices/ }), '1');
    await user.type(within(editor()).getByRole('textbox', { name: /Most choices/ }), '2');

    expect(await saved(user, sent, 'f_spend')).toMatchObject({
      type: 'multiple_choice',
      minSelections: 1,
      maxSelections: 2,
    });
  });
});

describe('what makes a question show', () => {
  const row = (n: number) =>
    within(editor()).getByRole('group', { name: `Condition ${String(n)}` });

  it('is read from the earlier questions, in words', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, NUMBER);

    expect(row(1)).toBeTruthy();
    expect(within(row(1)).getByRole('combobox', { name: 'Earlier question' })).toHaveProperty(
      'value',
      'f_charity',
    );
    expect(within(row(1)).getByRole('combobox', { name: 'Answer is' })).toHaveProperty(
      'value',
      '0',
    );
    expect(within(row(1)).getByRole('option', { name: 'Yes' })).toBeTruthy();
    expect(
      within(row(1))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Is your organisation a registered charity?', 'Yes', 'No']);
  });

  it('is changed to another answer, and removed', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, NUMBER);

    await user.selectOptions(within(row(1)).getByRole('combobox', { name: 'Answer is' }), 'No');
    expect((await saved(user, sent, 'f_number'))?.['conditions']).toEqual([
      { field: 'f_charity', equals: false },
    ]);

    await user.click(actionButton('Remove', 'condition 1'));
    expect(within(editor()).getByText('Applicants always see this question.')).toBeTruthy();
    expect(questionButton(NUMBER).textContent).not.toContain('Shown only for some answers');
  });

  it('is added from a question before it, which a choice question gives its choices to', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await user.click(sectionButton('Your project'));
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    await user.type(within(editor()).getByRole('textbox', { name: 'Question' }), 'Which building?');

    await user.click(within(editor()).getByRole('button', { name: 'Add condition' }));
    await user.selectOptions(
      within(row(1)).getByRole('combobox', { name: 'Earlier question' }),
      SPEND,
    );
    await user.selectOptions(
      within(row(1)).getByRole('combobox', { name: 'Answer is' }),
      'Training',
    );

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/^Saved /);
    const added = savedDefinition(sent).sections[1]?.fields[2];
    expect(added).toMatchObject({
      label: 'Which building?',
      conditions: [{ field: 'f_spend', equals: 'training' }],
    });
  });

  it('is read from a choice question that allows several, by what the answer includes', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, SPEND);
    await user.selectOptions(
      within(editor()).getByRole('combobox', { name: 'Type' }),
      'Choose several',
    );
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await user.click(within(editor()).getByRole('button', { name: 'Add condition' }));
    await user.selectOptions(
      within(row(1)).getByRole('combobox', { name: 'Earlier question' }),
      SPEND,
    );

    expect(within(row(1)).getByRole('combobox', { name: 'Answer includes' })).toBeTruthy();
  });

  it('cannot be added to a question that has nothing before it to read, and says why', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, ORG);

    const add = within(editor()).getByRole('button', { name: 'Add condition' });

    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      within(editor()).getByText(/Put a yes or no question or a choice question before/),
    ).toBeTruthy();
    await user.click(add);
    expect(within(editor()).queryByRole('group', { name: 'Condition 1' })).toBeNull();
  });
});

describe('stopping applicants', () => {
  it('is set for a yes or no answer, with what applicants are told', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, CHARITY);
    const panel = within(editor());
    expect(panel.getByRole<HTMLInputElement>('radio', { name: 'No' }).checked).toBe(true);
    expect(panel.getByRole('textbox', { name: 'What applicants are told' })).toHaveProperty(
      'value',
      'We only fund registered charities.',
    );

    await user.click(panel.getByRole('radio', { name: 'Yes' }));
    await user.clear(panel.getByRole('textbox', { name: 'What applicants are told' }));
    await user.type(
      panel.getByRole('textbox', { name: 'What applicants are told' }),
      'We do not fund charities.',
    );

    expect(await saved(user, sent, 'f_charity')).toMatchObject({
      eligibility: { stopWhen: true, explanation: 'We do not fund charities.' },
    });
  });

  it('is ended by choosing nobody, which takes the explanation away', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, CHARITY);

    await user.click(within(editor()).getByRole('radio', { name: /^Nobody/ }));

    expect(
      within(editor()).queryByRole('textbox', { name: 'What applicants are told' }),
    ).toBeNull();
    expect(questionButton(CHARITY).textContent).not.toContain('Stops some applicants');
    expect(await saved(user, sent, 'f_charity')).not.toHaveProperty('eligibility');
  });

  it('is set for the answers of a choice question that stop applicants, one or more', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, SPEND);
    const panel = within(editor());
    expect(panel.queryByRole('textbox', { name: 'What applicants are told' })).toBeNull();

    await user.click(panel.getByRole('checkbox', { name: 'Training' }));
    await user.type(
      panel.getByRole('textbox', { name: 'What applicants are told' }),
      'We do not fund training.',
    );

    expect(questionButton(SPEND).textContent).toContain('Stops some applicants');
    expect(await saved(user, sent, 'f_spend')).toMatchObject({
      eligibility: { stopValues: ['training'], explanation: 'We do not fund training.' },
    });
  });

  it('makes the question required and lets staff see the answer, which an eligibility question must be', async () => {
    const user = userEvent.setup();
    const sent = await openDraft(saves);
    await select(user, SPEND);
    await user.click(
      within(editor()).getByRole('checkbox', { name: 'Applicants must answer this question' }),
    );
    await user.selectOptions(
      within(editor()).getByRole('combobox', { name: 'Who sees the answer' }),
      'Reviewers only, not staff',
    );

    await user.click(within(editor()).getByRole('checkbox', { name: 'Building work' }));
    await user.type(
      within(editor()).getByRole('textbox', { name: 'What applicants are told' }),
      'We do not fund building work.',
    );

    expect(await saved(user, sent, 'f_spend')).toMatchObject({
      required: true,
      audiences: ['applicant', 'reviewer', 'staff'],
    });
  });

  it('is not offered for a question that cannot stop applicants', async () => {
    const user = userEvent.setup();
    await openDraft();
    await select(user, ORG);

    expect(within(editor()).queryByRole('heading', { name: 'Eligibility' })).toBeNull();
  });
});

describe('a question the builder cannot change yet', () => {
  it('can still be moved, removed and shown to others, and says its settings are not here', async () => {
    const user = userEvent.setup();
    await openDraft(
      {},
      {
        ...draft,
        definition: stored({
          sections: [
            {
              id: 's_budget',
              title: 'Budget',
              fields: [
                {
                  id: 'f_costs',
                  type: 'table',
                  label: 'Costs',
                  rowNoun: 'cost',
                  columns: [
                    { id: 'c_item', type: 'short_text', label: 'Item' },
                    { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
                  ],
                },
                { id: 'f_x', type: 'short_text', label: 'Anything else?' },
              ],
            },
          ],
        }),
      },
    );
    await user.click(questionButton('Costs'));

    const panel = within(editor());
    expect(
      panel.getByText('You cannot change the settings of this type of question here yet.'),
    ).toBeTruthy();
    expect(panel.queryByRole('combobox', { name: 'Type' })).toBeNull();
    expect(panel.getByRole('combobox', { name: 'Who sees the answer' })).toBeTruthy();
    expect(questionButton('Costs').textContent).toContain('Table');
    await user.click(actionButton('Move down', 'Costs'));
    expect(screen.getByText('Question moved to position 2 of 2')).toBeTruthy();
  });
});
