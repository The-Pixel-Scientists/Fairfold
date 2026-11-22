// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Answers } from '@pixel-scientists/domain/forms';
import { countCharacters, countWords, tableTotals } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import type { FormHelpers } from '@pixel-scientists/ui';

import type { PortalAnswersInput } from '../contracts/index.ts';

/** The engine's own counts and money format, so what the person sees is what the server checks. */
export const helpers: FormHelpers = { countWords, countCharacters, formatMoney, tableTotals };

/** The answers as a request body types them. call() checks them against the route's schema before it sends. */
export const asBody = (answers: Answers) => answers as PortalAnswersInput['answers'];

/** The answers with one question's answer set, or removed when the person clears it. */
export function withAnswer(answers: Answers, fieldId: string, value: unknown): Answers {
  const others = Object.entries(answers).filter(([id]) => id !== fieldId);
  return Object.fromEntries(value === null ? others : [...others, [fieldId, value]]);
}
