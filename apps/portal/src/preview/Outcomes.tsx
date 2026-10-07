// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of Section 4 of 6, outcomes: what will change for people, and how you
// will know, with the answers already saved.

import { AnswerScreen } from './AnswerScreen.tsx';
import { outcomes } from './form.ts';

export default function Outcomes() {
  return <AnswerScreen screen={outcomes} />;
}
