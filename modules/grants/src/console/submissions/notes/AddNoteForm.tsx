// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MemberName, NoteView } from '@pixel-scientists/domain/notes';
import { useLoad } from '@pixel-scientists/ui';
import { useState } from 'react';

import { ComposeForm } from './ComposeForm.tsx';
import { loadMentionable, postNote } from './loaders.ts';
import { MentionsPicker } from './MentionsPicker.tsx';
import { checkNote, MAX_NOTE_LENGTH } from './words.ts';

const NONE: readonly MemberName[] = [];

/** The note field with the people to tell. A refused mention keeps the body and the other people. */
export function AddNoteForm({
  submissionId,
  onAdded,
}: {
  submissionId: string;
  onAdded: (note: NoteView) => void;
}) {
  const { state, retry } = useLoad(loadMentionable, submissionId);
  const [chosen, setChosen] = useState(NONE);

  return (
    <ComposeForm
      label="Note for staff only. The applicant will not see this."
      hint="Write plain text. To tell someone, pick them below: names in the note do not notify anyone."
      submitLabel="Add note"
      max={MAX_NOTE_LENGTH}
      check={checkNote}
      send={async (text, key) => {
        const note = await postNote(
          submissionId,
          text,
          chosen.map((member) => member.membershipId),
          key,
        );
        setChosen(NONE);
        onAdded(note);
      }}
    >
      {(refused, clear) => (
        <MentionsPicker
          members={state.status === 'ready' ? state.value.members : NONE}
          loading={state.status === 'loading'}
          failed={state.status === 'failed'}
          retry={retry}
          chosen={chosen}
          onChange={(next) => {
            setChosen(next);
            clear();
          }}
          refused={refused}
        />
      )}
    </ComposeForm>
  );
}
