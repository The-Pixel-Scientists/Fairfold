// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { Button, EmptyState, FormField, Select, Textarea, useSubmit } from '@pixel-scientists/ui';
import { useState } from 'react';

import { createLearningNote, removeLearningNote } from '../contracts/index.ts';
import type { Framework, LearningNote } from '../contracts/index.ts';
import { FormDialog, RemoveDialog, Section } from './Page.tsx';
import { naming, topField } from './problems.ts';
import { formatDay } from './words.ts';

const WHOLE = 'framework';

function NoteDialog({
  framework,
  onClose,
  onSaved,
}: {
  framework: Framework;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [about, setAbout] = useState(WHOLE);
  const [text, setText] = useState('');
  const form = useSubmit(
    ['outcomeId', 'text'],
    naming(topField, async () => {
      await call(createLearningNote, {
        body: { frameworkId: framework.id, outcomeId: about === WHOLE ? null : about, text },
      });
      onSaved();
    }),
  );
  return (
    <FormDialog
      title="Add a learning note"
      description="Write down what you learned, so the next round starts from it."
      submit="Add note"
      form={form}
      onClose={onClose}
    >
      <FormField id="outcomeId" label="About" error={form.errorFor('outcomeId')}>
        <Select
          value={about}
          onChange={(event) => {
            setAbout(event.currentTarget.value);
          }}
        >
          <option value={WHOLE}>The whole framework</option>
          {Object.entries(framework.outcomes).map(([id, { name }]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="text" label="Note" error={form.errorFor('text')}>
        <Textarea
          rows={5}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}

/** A framework's learning notes, newest first, with a way to add and remove them for a member who may. */
export function NotesSection({
  framework,
  notes,
  canChange,
  reload,
}: {
  framework: Framework;
  notes: readonly LearningNote[];
  canChange: boolean;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState<'new' | LearningNote | null>(null);
  const close = () => {
    setOpen(null);
  };
  const saved = () => {
    close();
    return reload();
  };

  return (
    <Section
      title="Learning notes"
      action={
        canChange && (
          <Button
            onClick={() => {
              setOpen('new');
            }}
          >
            Add a learning note
          </Button>
        )
      }
    >
      {notes.length === 0 ? (
        <EmptyState title="No learning notes yet">
          <p>
            {canChange
              ? 'Add a note when a result teaches you something, such as why an indicator moved or what to change next time.'
              : 'Learning notes appear here once someone who records results adds them.'}
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider bg-surface">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-1 p-4">
              <p className="text-sm text-muted">
                {note.outcomeId === null
                  ? 'The whole framework'
                  : (framework.outcomes[note.outcomeId]?.name ?? 'An outcome')}
                {' · '}
                {formatDay(note.createdAt)}
              </p>
              <p className="whitespace-pre-line text-body text-ink">{note.text}</p>
              {canChange && (
                <div>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setOpen(note);
                    }}
                  >
                    Remove <span className="sr-only">note from {formatDay(note.createdAt)}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {open === 'new' && (
        <NoteDialog framework={framework} onClose={close} onSaved={() => void saved()} />
      )}
      {open !== null && open !== 'new' && (
        <RemoveDialog
          title="Remove this learning note?"
          description={open.text}
          submit="Remove note"
          onClose={close}
          action={async () => {
            await call(removeLearningNote, { params: { noteId: open.id } });
            await saved();
          }}
        />
      )}
    </Section>
  );
}
