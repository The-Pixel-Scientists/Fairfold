// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

import { Button } from '../Button.tsx';

export interface PasskeyItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyListProps {
  passkeys: readonly PasskeyItem[];
  /** The list's name for assistive technology, such as "Your passkeys". */
  label: string;
  /** What to show with no passkeys: what that means and what to do. */
  empty: ReactNode;
  onRemove: (passkey: PasskeyItem) => void;
}

const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

/** A person's passkeys, each with when it was added and last used, and a button to remove it that names it. */
export function PasskeyList({ passkeys, label, empty, onRemove }: PasskeyListProps) {
  if (passkeys.length === 0) return <div className="text-body text-muted">{empty}</div>;
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-divider">
      {passkeys.map((passkey) => (
        <li
          key={passkey.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
        >
          <div className="min-w-0">
            <p className="font-medium text-ink [overflow-wrap:anywhere]">{passkey.name}</p>
            <p className="text-body text-muted">
              Added {date.format(new Date(passkey.createdAt))}.{' '}
              {passkey.lastUsedAt === null
                ? 'Not used yet.'
                : `Last used ${date.format(new Date(passkey.lastUsedAt))}.`}
            </p>
          </div>
          <Button
            variant="quiet"
            aria-label={`Remove passkey ${passkey.name}`}
            onClick={() => {
              onRemove(passkey);
            }}
          >
            Remove passkey
          </Button>
        </li>
      ))}
    </ul>
  );
}
