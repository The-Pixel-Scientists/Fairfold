// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  ErrorSummary,
  FormField,
  Input,
  RadioGroup,
  Textarea,
  useLeaveGuard,
  useNavigate,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { createProgramme, programmeStatuses, updateProgramme } from '../../contracts/index.ts';
import type { Programme, ProgrammeStatus } from '../../contracts/index.ts';
import { FormFooter } from './FormFooter.tsx';
import { naming, topField } from './problems.ts';
import { PROGRAMMES_PATH, programmePath } from './paths.ts';

const FIELDS = ['title', 'summary', 'description', 'status'] as const;

const statusHints = {
  draft: 'Applicants cannot see it yet. Use this while you set it up.',
  open: 'Applicants can see it and apply to its open rounds.',
  closed: 'Applicants can no longer apply.',
} as const satisfies Record<ProgrammeStatus, string>;

const statusOptions = (Object.keys(programmeStatuses) as ProgrammeStatus[]).map((value) => ({
  value,
  label: programmeStatuses[value],
  hint: statusHints[value],
}));

const blank = { title: '', summary: '', description: '', status: 'draft' } as const;

/**
 * Creates a programme or, given one, changes it. A new programme opens its
 * own page once it is created; a changed one stays here, says it is saved
 * and is passed to `onSaved`.
 */
export function ProgrammeForm({
  programme,
  onSaved,
}: {
  programme?: Programme;
  onSaved?: (programme: Programme) => void;
}) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Programme | undefined>(programme);
  const initial = saved ?? blank;
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState<ProgrammeStatus>(initial.status);
  const [done, setDone] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const dirty =
    title !== initial.title ||
    summary !== initial.summary ||
    description !== initial.description ||
    status !== initial.status;
  useLeaveGuard(dirty && createdId === null);

  // Leave once the guard has gone: it goes when the page draws again without it.
  useEffect(() => {
    if (createdId !== null) navigate(programmePath(createdId));
  }, [createdId, navigate]);

  const form = useSubmit(
    FIELDS,
    naming(topField, async () => {
      const body = { title, summary, description, status };
      if (saved === undefined) {
        setCreatedId((await call(createProgramme, { body })).id);
        return;
      }
      const result = await call(updateProgramme, { params: { programmeId: saved.id }, body });
      setSaved(result);
      setTitle(result.title);
      setSummary(result.summary);
      setDescription(result.description);
      setStatus(result.status);
      setDone(true);
      onSaved?.(result);
    }),
  );

  function edit(change: () => void) {
    setDone(false);
    change();
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-3xl flex-col gap-5">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField
        id="title"
        label="Title"
        hint="Applicants see this name, for example Community Spaces Fund."
        error={form.errorFor('title')}
      >
        <Input
          value={title}
          autoComplete="off"
          onChange={(event) => {
            edit(() => {
              setTitle(event.currentTarget.value);
            });
          }}
        />
      </FormField>
      <FormField
        id="summary"
        label="Summary"
        hint="One or two sentences that applicants read before they apply."
        error={form.errorFor('summary')}
      >
        <Input
          value={summary}
          autoComplete="off"
          onChange={(event) => {
            edit(() => {
              setSummary(event.currentTarget.value);
            });
          }}
        />
      </FormField>
      <FormField
        id="description"
        label="Description"
        optional
        hint="More about what the programme funds and who it is for. Leave a blank line between paragraphs."
        error={form.errorFor('description')}
      >
        <Textarea
          rows={6}
          value={description}
          onChange={(event) => {
            edit(() => {
              setDescription(event.currentTarget.value);
            });
          }}
        />
      </FormField>
      <RadioGroup
        id="status"
        name="status"
        legend="Status"
        value={status}
        options={statusOptions}
        error={form.errorFor('status')}
        onValueChange={(value) => {
          edit(() => {
            setStatus(value as ProgrammeStatus);
          });
        }}
      />
      <FormFooter
        save={saved === undefined ? 'Create programme' : 'Save programme'}
        pending={form.pending}
        back={saved === undefined ? 'Cancel' : 'Back to programme'}
        backTo={saved === undefined ? PROGRAMMES_PATH : programmePath(saved.id)}
        saved={done && 'Programme saved.'}
      />
    </form>
  );
}
