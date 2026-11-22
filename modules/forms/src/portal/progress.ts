// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An anonymous respondent's answers, kept on this device only until they send
// them. The key is the form's public id and its version: no funder, name or
// answer. Only answers are stored, never a file, a token, a challenge or
// anything the server sent except the version, and they go after a
// successful send, when the form changes, or when the person clears them.

import { answersSchema, questionsOf } from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';

const PREFIX = 'form-progress:';

const keyOf = (formId: string, versionId: string) => `${PREFIX}${formId}:${versionId}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The answers to questions the form still asks, and never to a file. */
export function keepKnown(
  definition: FormDefinition,
  answers: Answers,
): { kept: Answers; dropped: number } {
  const asked = new Set(
    questionsOf(definition)
      .filter((q) => q.type !== 'file')
      .map((q) => q.id),
  );
  const entries = Object.entries(answers);
  const kept = entries.filter(([id]) => asked.has(id));
  return { kept: Object.fromEntries(kept), dropped: entries.length - kept.length };
}

export interface Restored {
  answers: Answers;
  /** Answers were found from an earlier visit. */
  restored: boolean;
  /** They were kept from an earlier version of the form. */
  changed: boolean;
  /** How many of those the new version no longer asks. */
  dropped: number;
  /** False when this browser lets the page keep nothing. */
  available: boolean;
}

function read(store: Storage, key: string): Answers | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = answersSchema.safeParse((JSON.parse(raw) as { answers?: unknown }).answers);
    if (parsed.success) return parsed.data;
  } catch {
    // Not ours or damaged: treated as nothing stored.
  }
  store.removeItem(key);
  return null;
}

/** The earlier visit's answers for this form and version; for another version, those it still asks. */
export function loadProgress(
  formId: string,
  versionId: string,
  definition: FormDefinition,
): Restored {
  const store = storage();
  const none = { answers: {}, restored: false, changed: false, dropped: 0 };
  if (store === null) return { ...none, available: false };
  try {
    const current = read(store, keyOf(formId, versionId));
    if (current !== null) return { ...none, answers: current, restored: true, available: true };
    const older = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => key !== null && key.startsWith(`${PREFIX}${formId}:`),
    );
    for (const key of older) {
      const answers = read(store, key);
      store.removeItem(key);
      if (answers === null) continue;
      const { kept, dropped } = keepKnown(definition, answers);
      saveProgress(formId, versionId, kept);
      return { answers: kept, restored: true, changed: true, dropped, available: true };
    }
    return { ...none, available: true };
  } catch {
    return { ...none, available: false };
  }
}

/** Keeps the answers, or removes the entry when there are none. False when the browser refused. */
export function saveProgress(formId: string, versionId: string, answers: Answers): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    if (Object.keys(answers).length === 0) store.removeItem(keyOf(formId, versionId));
    else store.setItem(keyOf(formId, versionId), JSON.stringify({ answers }));
    return true;
  } catch {
    return false;
  }
}

/** Removes what was kept for the form, whatever its version. */
export function clearProgress(formId: string): void {
  const store = storage();
  if (store === null) return;
  try {
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(`${PREFIX}${formId}:`)) store.removeItem(key);
    }
  } catch {
    // Nothing to remove when the browser will not say.
  }
}
