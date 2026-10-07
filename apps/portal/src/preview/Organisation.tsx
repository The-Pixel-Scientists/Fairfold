// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of Section 1 of 6, about your organisation: who you are, your main
// contact, and your size, with the answers already saved.

import { AnswerScreen } from './AnswerScreen.tsx';
import { organisation } from './form.ts';

export default function Organisation() {
  return <AnswerScreen screen={organisation} />;
}
