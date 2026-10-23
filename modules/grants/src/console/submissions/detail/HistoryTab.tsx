// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Submission, SubmissionEvent } from '../../../contracts/index.ts';
import { formatMoment } from '../../programme/format.ts';

/** What happened, in a sentence. */
export function eventText(event: SubmissionEvent): string {
  switch (event.event) {
    case 'submitted':
      return 'Submitted';
    case 'withdrawn':
      return 'Withdrawn by the applicant';
    case 'stage_changed':
      return event.from === null
        ? `Entered ${event.to.name}`
        : `Moved from ${event.from.name} to ${event.to.name}`;
  }
}

/** Everything that has happened to the submission, newest first. */
export function HistoryTab({ history }: { history: Submission['history'] }) {
  const newestFirst = [...history].reverse();
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <p className="text-body text-muted">
        Each change is also in the audit log, which cannot be edited.
      </p>
      <ol aria-label="History, newest first" className="flex flex-col">
        {newestFirst.map((event, index) => (
          <li
            key={`${event.at}:${event.event}:${String(index)}`}
            className="relative flex gap-4 pb-5 last:pb-0"
          >
            {index < newestFirst.length - 1 && (
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
              <p className="text-body text-ink">{eventText(event)}</p>
              <p className="text-sm text-muted">
                {event.by ?? 'Name not on record'}, {formatMoment(event.at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
