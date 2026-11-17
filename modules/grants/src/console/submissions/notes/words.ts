// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  messageBodySchema,
  noteBodySchema,
} from '@pixel-scientists/domain/notes';

const tooLong = (max: number) => `Shorten this to ${String(max)} characters or fewer.`;

interface Check {
  safeParse: (
    value: string,
  ) => { success: true } | { success: false; error: { issues: readonly { message: string }[] } };
}

function checker(schema: Check, max: number) {
  return (text: string): string | null => {
    if (text.length > max) return tooLong(max);
    const parsed = schema.safeParse(text);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? tooLong(max));
  };
}

/** The shared domain check, so the browser refuses what the server would, in the same words. */
export const checkNote = checker(noteBodySchema, MAX_NOTE_LENGTH);

export const checkMessage = checker(messageBodySchema, MAX_MESSAGE_LENGTH);

export { MAX_MESSAGE_LENGTH, MAX_NOTE_LENGTH };

/** A member by display name; some have none. */
export const nameOf = (name: string | null) => name ?? 'A team member';
