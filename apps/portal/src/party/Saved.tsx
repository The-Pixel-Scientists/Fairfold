// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Your details are saved." and the like, shown on the page a person comes
// back to after saving. The page's address says which, as `?saved=details`.

import { useSearch } from '@pixel-scientists/ui';
import type { SearchSchema } from '@pixel-scientists/ui';

const words = {
  details: 'Your details are saved.',
  'organisation-added': 'Your organisation is added.',
  'organisation-changed': 'Your organisation details are saved.',
  'future-funding': 'Your choice is saved.',
} as const;

export type Saved = keyof typeof words;

/** The path, with the word that makes the page say what was saved. */
export function savedPath(path: string, saved: Saved): string {
  return `${path}?saved=${saved}`;
}

const savedSchema: SearchSchema<Saved | null> = {
  safeParse(input) {
    const { saved } = input as Record<string, string | string[] | undefined>;
    return {
      success: true,
      data: (Object.keys(words) as Saved[]).find((key) => key === saved) ?? null,
    };
  },
};

/** What was just saved, in words, or nothing when the address does not say. */
export function SavedNotice() {
  const result = useSearch(savedSchema);
  const saved = result.success ? result.data : null;
  if (saved === null) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-divider bg-success-soft p-4 text-body font-medium text-ink"
    >
      {words[saved]}
    </p>
  );
}
