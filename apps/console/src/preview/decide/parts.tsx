// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Small pieces the decide previews share: the preview tag, a notice and the
// few icons they need.

import { Tag, cx } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

/** What every preview's eyebrow starts with: the Design preview tag, then anything that places the page. */
export function Eyebrow({ children }: { children?: ReactNode }) {
  return (
    <>
      <Tag tone="info">Design preview</Tag>
      {children}
    </>
  );
}

const icons = {
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  check: <path d="m3.5 8.5 3 3 6-7" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25V11M8 5v.01" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.5v.01" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75" />
      <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.75-.75" />
    </>
  ),
} as const;

export type IconName = keyof typeof icons;

/** A 16px line icon in the colour of the text around it. It is decoration, so it is hidden from assistive technology. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cx('size-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

type NoticeTone = 'neutral' | 'info' | 'success' | 'warning';

const noticeTones: Record<NoticeTone, { box: string; icon: string }> = {
  neutral: { box: 'border-divider bg-sunken/60', icon: 'text-muted' },
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info' },
  success: { box: 'border-success/30 bg-success-soft', icon: 'text-success' },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: 'text-warning' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  icon: IconName;
  /** The point of the notice, in a short sentence. */
  title: string;
  /** What it means, and what to do about it. */
  children?: ReactNode;
  /** A button or link that deals with it. */
  action?: ReactNode;
  id?: string;
}

/** A calm message set into the page: an icon, a title in words and what follows from it. */
export function Notice({ tone = 'neutral', icon, title, children, action, id }: NoticeProps) {
  const { box, icon: iconColour } = noticeTones[tone];
  return (
    <div
      id={id}
      className={cx('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border p-3.5', box)}
    >
      <Icon name={icon} className={cx('mt-0.5', iconColour)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body text-ink">
        <p className="font-medium">{title}</p>
        {children !== undefined && <div>{children}</div>}
      </div>
      {action !== undefined && <div className="basis-full sm:basis-auto">{action}</div>}
    </div>
  );
}
