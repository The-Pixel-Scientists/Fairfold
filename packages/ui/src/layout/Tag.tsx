// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export type TagTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface TagProps {
  /**
   * Neutral for drafts and not started; info for in progress and open;
   * success for done; warning for attention; danger for a problem.
   */
  tone?: TagTone;
  /** The status in words, such as "In review". The tone only reinforces it. */
  children: ReactNode;
}

const tones: Record<TagTone, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-sunken text-ink', dot: 'bg-muted' },
  info: { pill: 'bg-info-soft text-info', dot: 'bg-info' },
  success: { pill: 'bg-success-soft text-success', dot: 'bg-success' },
  warning: { pill: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  danger: { pill: 'bg-danger-soft text-danger', dot: 'bg-danger' },
};

/**
 * A short status label with a dot, such as "Awarded" or "In review". The
 * words carry the meaning; colour and the dot only back them up, so a tag is
 * never colour alone.
 */
export function Tag({ tone = 'neutral', children }: TagProps) {
  const { pill, dot } = tones[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset',
        pill,
      )}
    >
      <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', dot)} />
      {children}
    </span>
  );
}
