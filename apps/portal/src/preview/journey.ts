// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the applying previews share beyond the story: when each screen was last
// saved and the documents the application holds. Every name and number is made up.

/** When the application was last saved, as the previews say it: "Saved at 10:36am". */
export const savedAt = new Date(2027, 1, 24, 10, 36);

/** When the documents were last saved, two days after the budget. */
export const documentsSavedAt = new Date(2027, 1, 26, 15, 5);

/** The documents the round asks for, with the files as they stand on the documents screen. */
export const documents = [
  {
    id: 'accounts',
    label: 'Your latest accounts',
    hint: 'Or a record of the money you have received and spent, if your group is new.',
    file: { name: 'Accounts 2025 to 2026.pdf', size: 1_258_291 },
  },
  {
    id: 'constitution',
    label: 'Your constitution',
    hint: 'The rules your group runs by. It may be called a governing document.',
    file: { name: 'Constitution.pdf', size: 856_064 },
  },
  {
    id: 'safeguarding',
    label: 'Your safeguarding policy',
    hint: 'How you keep children and adults at risk safe.',
    file: { name: 'Safeguarding policy.docx', size: 3_355_443 },
  },
] as const;

/** Attached to the budget, beside the other funding it confirms. */
export const fundingEvidence = {
  id: 'funding-evidence',
  label: 'Evidence of other funding',
  hint: 'A letter or email from each funder that confirms the money.',
  file: { name: 'Parish council letter.pdf', size: 215_040 },
} as const;

export const fileRules = 'PDF or Word, up to 10 MB.';
