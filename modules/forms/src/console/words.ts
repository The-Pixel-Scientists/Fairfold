// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Values of the contracts in the words staff read (docs/CONTENT-STYLE.md).

import type { Respondents, ResponseRoute, SpamReason } from '../contracts/index.ts';

export const statusWords = { draft: 'Draft', published: 'Published' } as const;

export const respondentWords: Record<Respondents, string> = {
  signed_in: 'People who sign in',
  anonymous: 'Anyone',
  both: 'Anyone, signed in or not',
};

export const routeWords: Record<ResponseRoute, string> = {
  signed_in: 'Signed in',
  anonymous: 'Anonymous',
};

export const spamWords: Record<SpamReason, string> = {
  automated: 'Sent by a script or bot',
  abusive: 'Abusive',
  unrelated: 'Not about this form',
  duplicate: 'A duplicate',
  test: 'A test',
};
