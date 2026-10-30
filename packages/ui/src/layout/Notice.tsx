// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type NoticeIcon = 'info' | 'check' | 'alert' | 'lock';

const icons: Record<NoticeIcon, ReactNode> = {
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
};

const tones: Record<NoticeTone, { box: string; icon: string; mark: NoticeIcon }> = {
  neutral: { box: 'border-divider bg-sunken/60', icon: 'text-muted', mark: 'info' },
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info', mark: 'info' },
  success: { box: 'border-success/30 bg-success-soft', icon: 'text-success', mark: 'check' },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: 'text-warning', mark: 'alert' },
  danger: { box: 'border-danger/30 bg-danger-soft', icon: 'text-danger', mark: 'alert' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  /** The mark before the title. Defaults to the tone's own: information, a tick or a warning triangle. */
  icon?: NoticeIcon;
  /** The point of the notice, in a short sentence. It carries the meaning; the tone only reinforces it. */
  title: string;
  /** What it means, and what to do about it. */
  children?: ReactNode;
  /** A button or link that deals with it. */
  action?: ReactNode;
  id?: string;
  className?: string;
}

/**
 * A calm message set into the page: a mark, a title in words and what follows
 * from it. It is not announced when it appears. To announce a message that
 * appears after an action, put the notice inside an element with
 * `role="status"`, or use `role="alert"` for a failure.
 */
export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  id,
  className,
}: NoticeProps) {
  const style = tones[tone];
  return (
    <div
      id={id}
      className={cx(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border p-3.5',
        style.box,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={cx('mt-0.5 size-4 shrink-0', style.icon)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icons[icon ?? style.mark]}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body text-ink">
        <p className="font-medium">{title}</p>
        {children !== undefined && <div>{children}</div>}
      </div>
      {action ? <div className="basis-full sm:basis-auto">{action}</div> : null}
    </div>
  );
}
