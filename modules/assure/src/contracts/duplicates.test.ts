// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { flagDismissalInputSchema } from './duplicates.ts';
import { assureMessages } from './messages.ts';

function firstMessage(result: { error?: { issues: object[] } }): string {
  const [issue] = result.error?.issues ?? [];
  return issue === undefined ? 'no problem' : messageForIssue(issue);
}

describe('duplicate flags', () => {
  it('are dismissed with a reason from the list', () => {
    expect(flagDismissalInputSchema.safeParse({ reason: 'related_but_separate' }).success).toBe(
      true,
    );
    expect(firstMessage(flagDismissalInputSchema.safeParse({ reason: 'blocked' }))).toBe(
      assureMessages.flagReason,
    );
  });
});
