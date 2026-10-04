// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';

/**
 * What a person has typed into a control whose answer is not text, such as a
 * number or a date. While they type, "12." or a date with a missing year is
 * not yet an answer but must stay on screen. The draft is kept here and
 * starts again from the answer only when the answer changes from outside, for
 * example when a saved draft loads or the form is reset.
 */
export function useDraft<T>(
  answer: unknown,
  draftOf: (answer: unknown) => T,
): [draft: T, change: (draft: T, answer: unknown) => void] {
  const key = JSON.stringify(answer ?? null);
  const [state, setState] = useState({ key, draft: draftOf(answer) });
  if (state.key !== key) setState({ key, draft: draftOf(answer) });

  return [
    state.draft,
    (nextDraft, nextAnswer) => {
      setState({ key: JSON.stringify(nextAnswer ?? null), draft: nextDraft });
    },
  ];
}
