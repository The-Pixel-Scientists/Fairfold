// SPDX-License-Identifier: AGPL-3.0-or-later

import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import type { Answers } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { FILE_ID, attachment, completeAnswers, definition } from '../testing/apply.ts';
import {
  ELIGIBILITY_SCREEN,
  controlId,
  isAnswered,
  minutesToAnswer,
  needsOf,
  problemsOf,
  questionsLeft,
  savable,
  screensOf,
  shownIds,
  shownScreens,
  statusOf,
  stopsOf,
  timeWords,
  toFix,
  withFiles,
} from './form.ts';

const titles = (screens: { title: string }[]) => screens.map(({ title }) => title);

describe('screensOf', () => {
  it('puts the eligibility questions first, on a screen of their own', () => {
    const [first, ...sections] = screensOf(definition);

    expect(first?.id).toBe(ELIGIBILITY_SCREEN);
    expect(first?.fields.map(({ id }) => id)).toEqual(['f_charity']);
    expect(titles(sections)).toEqual(['About your organisation', 'Your project', 'Budget']);
    expect(sections[0]?.fields.map(({ id }) => id)).not.toContain('f_charity');
  });

  it('draws file questions with the others', () => {
    const budget = screensOf(definition).find(({ id }) => id === 's_budget');

    expect(budget?.fields.map(({ id }) => id)).toEqual(['f_costs', 'f_accounts']);
  });
});

describe('shownScreens', () => {
  it('leaves out a screen with no question shown for the answers', () => {
    const sections = shownScreens(definition, {});

    expect(titles(sections)).toEqual([
      'Check you can apply',
      'About your organisation',
      'Your project',
      'Budget',
    ]);
  });
});

describe('withFiles', () => {
  it('answers a file question with the ids of its files, in the order attached', () => {
    const second = attachment({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' });

    const answers = withFiles(definition, completeAnswers, [attachment(), second]);

    expect(answers['f_accounts']).toEqual([FILE_ID, second.id]);
  });

  it('leaves a question with no files unanswered, whatever the answers held', () => {
    const answers = withFiles(definition, { ...completeAnswers, f_accounts: [FILE_ID] }, []);

    expect(Object.hasOwn(answers, 'f_accounts')).toBe(false);
  });

  it('ignores a file on another question', () => {
    const answers = withFiles(definition, completeAnswers, [attachment({ fieldId: 'f_other' })]);

    expect(Object.hasOwn(answers, 'f_accounts')).toBe(false);
  });

  it('does not answer a question that is not shown', () => {
    const hidden = formDefinitionSchema.parse({
      sections: [
        {
          id: 's_files',
          title: 'Files',
          fields: [
            { id: 'f_lease', type: 'yes_no', label: 'Do you lease the building?' },
            {
              id: 'f_accounts',
              type: 'file',
              label: 'A copy of the lease',
              conditions: [{ field: 'f_lease', equals: true }],
            },
          ],
        },
      ],
    });

    expect(withFiles(hidden, { f_lease: false }, [attachment()])).toEqual({ f_lease: false });
    expect(withFiles(hidden, { f_lease: true }, [attachment()])).toEqual({
      f_lease: true,
      f_accounts: [FILE_ID],
    });
  });
});

describe('problemsOf', () => {
  it('asks for a required file until one is attached', () => {
    expect(problemsOf(definition, completeAnswers, 'submit')).toEqual([
      { field: 'f_accounts', message: 'Upload a file for this question.' },
    ]);
    expect(
      problemsOf(definition, withFiles(definition, completeAnswers, [attachment()]), 'submit'),
    ).toEqual([]);
  });

  it('names what is missing and what is wrong', () => {
    const problems = problemsOf(definition, { f_name: 'Eastmere', f_contact: 'ada@' }, 'submit');

    expect(problems.map(({ field }) => field)).toEqual(
      expect.arrayContaining(['f_contact', 'f_charity', 'f_summary', 'f_costs']),
    );
  });
});

describe('isAnswered', () => {
  it.each([
    [false, true],
    [0, true],
    ['Ada', true],
    [['a'], true],
    ['  ', false],
    ['', false],
    [[], false],
    [null, false],
    [undefined, false],
  ])('%j is %s', (value, answered) => {
    expect(isAnswered(value)).toBe(answered);
  });
});

describe('statusOf', () => {
  const [, about] = screensOf(definition);
  if (about === undefined) throw new Error('The test form has no sections.');
  const status = (answers: Answers) =>
    statusOf(
      about,
      shownIds(definition, answers),
      answers,
      problemsOf(definition, answers, 'submit'),
    );

  it('is not started until a question is answered', () => {
    expect(status({})).toBe('not-started');
  });

  it('is in progress while a shown question still has a problem', () => {
    expect(status({ f_name: 'Eastmere' })).toBe('in-progress');
  });

  it('is completed once nothing is missing or wrong', () => {
    expect(status(completeAnswers)).toBe('completed');
  });

  it('counts the questions left', () => {
    const answers = { f_name: 'Eastmere' };

    expect(
      questionsLeft(
        about,
        shownIds(definition, answers),
        problemsOf(definition, answers, 'submit'),
      ),
    ).toBe(2);
  });
});

describe('savable', () => {
  it('keeps the answers to shown questions, in the form’s order, and drops the rest', () => {
    const { body, held } = savable(
      definition,
      {
        f_summary: 'A weekly lunch.',
        f_name: 'Eastmere',
        f_web: 'https://eastmere.example',
        f_people: null,
        f_accounts: ['d2b1c0a9-8e7f-4a6b-9c5d-4e3f2a1b0c9d'],
        f_unknown: 'x',
      },
      {},
    );

    expect(Object.keys(body)).toEqual(['f_name', 'f_summary']);
    expect(held).toEqual([]);
  });

  it('keeps what was saved for an answer that cannot be saved yet, and says which', () => {
    const { body, held } = savable(
      definition,
      { f_name: 'Eastmere', f_contact: 'ada@' },
      { f_contact: 'ada@example.org' },
    );

    expect(body).toEqual({ f_name: 'Eastmere', f_contact: 'ada@example.org' });
    expect(held).toEqual(['f_contact']);
  });

  it('saves nothing for an answer that cannot be saved yet when nothing was saved before', () => {
    const { body, held } = savable(definition, { f_contact: 'ada@' }, {});

    expect(body).toEqual({});
    expect(held).toEqual(['f_contact']);
  });
});

describe('toFix', () => {
  it('names the screen, the label and the control to go to', () => {
    const answers = { f_charity: true, f_costs: [{ c_item: 'Hall hire', c_cost: null }] };
    const fixes = toFix(screensOf(definition), problemsOf(definition, answers, 'submit'));

    expect(fixes.find(({ label }) => label === 'Costs of the project')).toMatchObject({
      screen: { title: 'Budget' },
      controlId: 'f_costs-1-c_cost',
      message: 'Enter an amount for cost 1.',
    });
    expect(fixes.find(({ label }) => label === 'Project summary')).toMatchObject({
      controlId: 'f_summary',
    });
  });

  it('points at a missing file by the id of its input, on the screen that asks for it', () => {
    const fixes = toFix(screensOf(definition), problemsOf(definition, completeAnswers, 'submit'));

    expect(fixes).toMatchObject([
      {
        screen: { title: 'Budget' },
        label: 'Your latest accounts',
        controlId: 'f_accounts',
        message: 'Upload a file for this question.',
      },
    ]);
  });

  it('points at the first box of an address, and at the part that is wrong', () => {
    expect(controlId({ field: 'f_address.line1', message: '' })).toBe('f_address');
    expect(controlId({ field: 'f_address.town', message: '' })).toBe('f_address-town');
    expect(controlId({ field: 'f_name', message: '' })).toBe('f_name');
  });
});

describe('what the round page says', () => {
  it('estimates the time from the questions, to the nearest five minutes', () => {
    expect(minutesToAnswer(definition)).toBe(15);
  });

  it.each([
    [5, 'about 5 minutes'],
    [45, 'about 45 minutes'],
    [60, 'about an hour'],
    [90, 'about 2 hours'],
    [180, 'about 3 hours'],
  ])('writes %i minutes as "%s"', (minutes, words) => {
    expect(timeWords(minutes)).toBe(words);
  });

  it('lists the files and tables to have ready', () => {
    expect(needsOf(definition)).toEqual([
      { title: 'Costs of the project', text: 'Add a row for each cost.' },
      { title: 'Your latest accounts', text: 'A PDF or Word document.' },
    ]);
  });

  it('gives the funder’s own words for who cannot apply', () => {
    expect(stopsOf(definition)).toEqual(['This programme is open to registered charities only.']);
  });
});
