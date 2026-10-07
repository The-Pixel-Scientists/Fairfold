// SPDX-License-Identifier: AGPL-3.0-or-later

import { history } from '../featured.ts';

/** Everything that has happened to the application, newest first. Each entry is also in the audit log. */
export function HistoryTab() {
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <p className="text-body text-muted">
        Every change is recorded in the audit log, which cannot be edited.
      </p>
      <ol className="flex flex-col">
        {history.map((entry, index) => (
          <li key={entry.when} className="relative flex gap-4 pb-5 last:pb-0">
            {index < history.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-0 left-[0.3125rem] w-px bg-divider"
              />
            )}
            <span
              aria-hidden="true"
              className="relative mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-edge bg-surface"
            />
            <div className="flex min-w-0 flex-col">
              <p className="text-body text-ink">{entry.what}</p>
              <p className="text-sm text-muted">
                {entry.who}, {entry.when}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
