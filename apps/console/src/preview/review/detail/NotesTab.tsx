// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Note } from '../featured.ts';

/** One internal note: who wrote it, when, and what it says. */
export function NoteItem({ note }: { note: Note }) {
  return (
    <li className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium text-ink">{note.author}</span>
        <span className="text-sm text-muted">{note.when}</span>
      </p>
      <p className="text-body text-ink">{note.text}</p>
    </li>
  );
}

/** Every internal note on the application, newest first. */
export function NotesTab({ notes }: { notes: readonly Note[] }) {
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <p className="text-body text-muted">
        Notes are for staff. Applicants and reviewers never see them. Add a note from the panel
        beside the application.
      </p>
      <ul className="flex flex-col divide-y divide-divider">
        {notes.map((note) => (
          <NoteItem key={`${note.when}:${note.text}`} note={note} />
        ))}
      </ul>
    </div>
  );
}
