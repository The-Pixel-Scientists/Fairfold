// SPDX-License-Identifier: AGPL-3.0-or-later

import { cx } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

export interface NoticeProps {
  /** What the notice is about, in a short sentence. */
  title: string;
  /** An icon for the notice. It is decoration, so the title carries the meaning. */
  icon: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning';
  children: ReactNode;
}

const tones = {
  neutral: { box: 'border-divider bg-sunken/60', icon: 'text-muted' },
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info' },
  success: { box: 'border-success/25 bg-success-soft', icon: 'text-success' },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: 'text-warning' },
} as const;

/** A short explanation that sits in the page, such as why part of an application is hidden. */
export function Notice({ title, icon, tone = 'neutral', children }: NoticeProps) {
  const { box, icon: iconTone } = tones[tone];
  return (
    <div className={cx('flex gap-3 rounded-lg border p-4', box)}>
      <span className={cx('mt-0.5', iconTone)}>{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold text-ink">{title}</p>
        <div className="flex max-w-prose flex-col gap-2 text-body text-ink/85">{children}</div>
      </div>
    </div>
  );
}
