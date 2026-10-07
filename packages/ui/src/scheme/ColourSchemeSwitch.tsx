// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../cx.ts';
import { setSchemeChoice, useSchemeChoice } from './colourScheme.ts';
import type { SchemeChoice } from './colourScheme.ts';

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 16 16',
  className: 'size-4 shrink-0',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
} as const;

const options: readonly { value: SchemeChoice; label: string; icon: ReactNode }[] = [
  {
    value: 'device',
    label: 'Device',
    icon: (
      <svg {...iconProps}>
        <circle cx="8" cy="8" r="5.25" />
        <path d="M8 2.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg {...iconProps}>
        <circle cx="8" cy="8" r="2.75" />
        <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg {...iconProps}>
        <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z" />
      </svg>
    ),
  },
];

/**
 * Light, dark, or whatever the device uses, which is the default. Three
 * radio buttons, so Tab reaches the group and the arrow keys choose. The
 * choice applies at once and is kept in this browser.
 */
export function ColourSchemeSwitch({ className }: { className?: string }) {
  const choice = useSchemeChoice();
  const name = useId();

  return (
    <fieldset className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <legend className="float-left text-sm text-muted">Appearance</legend>
      <div className="inline-flex gap-0.5 rounded-full bg-sunken p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              'inline-flex min-h-target cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-sm',
              'transition-colors duration-(--motion-fast) ease-standard',
              'border-transparent text-muted hover:text-ink',
              'has-checked:border-edge has-checked:bg-surface has-checked:font-semibold has-checked:text-ink has-checked:shadow-(--shadow-raised)',
              'forced-colors:has-checked:underline forced-colors:has-checked:underline-offset-4',
              'has-focus-visible:outline-(length:--focus-ring-width) has-focus-visible:outline-offset-(length:--focus-ring-offset) has-focus-visible:outline-focus has-focus-visible:outline-solid',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={choice === option.value}
              onChange={() => {
                setSchemeChoice(option.value);
              }}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
