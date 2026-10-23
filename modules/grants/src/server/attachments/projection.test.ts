// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseDefinition, projectAnswers } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

const parsed = parseDefinition({
  sections: [
    {
      id: 's_one',
      title: 'About',
      fields: [
        { id: 'f_idea', type: 'long_text', label: 'Idea' },
        { id: 'f_accounts', type: 'file', label: 'Accounts' },
        { id: 'f_papers', type: 'file', label: 'Papers', audiences: ['applicant'] },
      ],
    },
  ],
});
if (!parsed.success) throw new Error('The test definition is not valid.');

const answers = { f_idea: 'A new roof', f_accounts: ['file-one'], f_papers: ['file-two'] };

describe('the answers to a file question', () => {
  it('reach the applicant, and staff for questions whose audiences include them', () => {
    expect(projectAnswers(parsed.data, answers, 'applicant')).toEqual(answers);
    expect(projectAnswers(parsed.data, answers, 'staff')).toEqual({
      f_idea: 'A new roof',
      f_accounts: ['file-one'],
    });
  });

  it('never reach a blind reviewer, whatever the question allows', () => {
    expect(projectAnswers(parsed.data, answers, 'blind_reviewer')).toEqual({
      f_idea: 'A new roof',
    });
  });
});
