// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NoteView } from '@pixel-scientists/domain/notes';
import { Button, LoadingState, Panel, useLoad } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { formatMoment } from '../../programme/format.ts';
import { AddNoteForm } from './AddNoteForm.tsx';
import { Body } from './Body.tsx';
import { loadNotes } from './loaders.ts';
import { nameOf } from './words.ts';

function Note({ note, focused }: { note: NoteView; focused: boolean }) {
  const element = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) element.current?.focus();
  }, [focused]);
  return (
    <li
      ref={element}
      tabIndex={-1}
      className="flex flex-col gap-1 border-t border-divider pt-3 first:border-t-0 first:pt-0"
    >
      <p className="text-sm text-muted">
        {nameOf(note.author.name)}, {formatMoment(note.createdAt)}
      </p>
      <Body text={note.body} />
      {note.mentions.length > 0 && (
        <p className="text-sm text-muted">
          Mentioned: {note.mentions.map((member) => nameOf(member.name)).join(', ')}
        </p>
      )}
    </li>
  );
}

function Notes({ submissionId, initial }: { submissionId: string; initial: readonly NoteView[] }) {
  const [notes, setNotes] = useState(initial);
  const [added, setAdded] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  return (
    <>
      <AddNoteForm
        submissionId={submissionId}
        onAdded={(note) => {
          setNotes((was) => [note, ...was]);
          setAdded(note.id);
          setSaid('Note added');
        }}
      />
      <p role="status" className="sr-only">
        {said}
      </p>
      {notes.length === 0 ? (
        <p className="text-body text-muted">
          No notes have been added yet. Add one to share context with your team.
        </p>
      ) : (
        <ol aria-label="Notes, newest first" className="flex flex-col gap-3">
          {notes.map((note) => (
            <Note key={note.id} note={note} focused={note.id === added} />
          ))}
        </ol>
      )}
    </>
  );
}

/** Private staff notes on a submission, newest first. Notes are never edited or deleted: a correction is a new note. */
export function NotesPanel({ submissionId }: { submissionId: string }) {
  const { state, retry } = useLoad(loadNotes, submissionId);
  return (
    <Panel title="Notes">
      {state.status === 'loading' && <LoadingState label="Loading notes" />}
      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-danger">{state.message}</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && (
        <Notes submissionId={submissionId} initial={state.value.notes} />
      )}
    </Panel>
  );
}
