// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Editing the outcome emails, kept apart from the pages that show them so
// it can be taken out on its own.

import { call } from '@pixel-scientists/domain/api';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Panel,
  Textarea,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import {
  mergeFields,
  mergeFieldsFor,
  outcomeIds,
  outcomes,
  setEmailTemplates,
} from '../../contracts/index.ts';
import type { EmailTemplates, MergeField, Outcome } from '../../contracts/index.ts';
import { FormFooter } from './FormFooter.tsx';
import { programmePath } from './paths.ts';
import { naming } from './problems.ts';

type Part = 'subject' | 'body';

interface Texts {
  subject: string;
  body: string;
}

type Values = Record<Outcome, Texts>;

const boxId = (outcome: Outcome, part: Part) => `${outcome}-${part}`;

const FIELDS = outcomeIds.flatMap((outcome) => [boxId(outcome, 'subject'), boxId(outcome, 'body')]);

/** `body.accepted.subject` is the box for the accepted email's subject. */
const boxFor = (field: string) => field.replace(/^body\./, '').replace('.', '-');

const valuesOf = (templates: EmailTemplates): Values => ({
  accepted: { subject: templates.accepted.subject, body: templates.accepted.body },
  waitlisted: { subject: templates.waitlisted.subject, body: templates.waitlisted.body },
  declined: { subject: templates.declined.subject, body: templates.declined.body },
});

const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);

interface Insertion {
  /** The box the field went into, and where the cursor goes after it. */
  id: string;
  caret: number;
}

/** Merge fields to add at the cursor, for one email. */
function MergeFieldButtons({
  outcome,
  onInsert,
}: {
  outcome: Outcome;
  onInsert: (field: MergeField) => void;
}) {
  return (
    <div role="group" aria-label={`Merge fields for the ${outcomes[outcome].toLowerCase()} email`}>
      <p className="text-sm text-muted">
        Add a merge field where your cursor is. It becomes the applicant&apos;s own details when the
        email is sent.
      </p>
      <ul role="list" className="mt-1 flex flex-wrap gap-1">
        {mergeFieldsFor[outcome].map((field) => (
          <li key={field}>
            <Button
              variant="secondary"
              className="min-h-target"
              onClick={() => {
                onInsert(field);
              }}
            >
              {mergeFields[field]}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The three outcome emails as one form, with the version each is on. */
export function EmailTemplateEditor({
  programmeId,
  templates,
}: {
  programmeId: string;
  templates: EmailTemplates;
}) {
  const [saved, setSaved] = useState(templates);
  const [values, setValues] = useState(() => valuesOf(templates));
  const [done, setDone] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastPart = useRef<Record<Outcome, Part>>({
    accepted: 'body',
    waitlisted: 'body',
    declined: 'body',
  });
  const insertion = useRef<Insertion | null>(null);

  useLeaveGuard(!same(values, valuesOf(saved)));

  // After a merge field goes in, the cursor stays in the box, after it.
  useEffect(() => {
    if (insertion.current === null) return;
    const box = document.getElementById(insertion.current.id);
    if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) {
      box.focus();
      box.setSelectionRange(insertion.current.caret, insertion.current.caret);
    }
    insertion.current = null;
  }, [values]);

  const form = useSubmit(
    FIELDS,
    naming(boxFor, async () => {
      const result = await call(setEmailTemplates, { params: { programmeId }, body: values });
      setSaved(result);
      setValues(valuesOf(result));
      setDone(true);
    }),
  );

  function edit(outcome: Outcome, part: Part, text: string) {
    setDone(false);
    setValues((current) => ({ ...current, [outcome]: { ...current[outcome], [part]: text } }));
  }

  function insert(outcome: Outcome, field: MergeField) {
    const part = lastPart.current[outcome];
    const id = boxId(outcome, part);
    const box = document.getElementById(id);
    const text = values[outcome][part];
    const target =
      box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement ? box : null;
    const start = target?.selectionStart ?? text.length;
    const end = target?.selectionEnd ?? start;
    const merge = `{{${field}}}`;
    insertion.current = { id, caret: start + merge.length };
    edit(outcome, part, text.slice(0, start) + merge + text.slice(end));
    setAnnouncement(`${mergeFields[field]} added to the ${part}`);
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-3xl flex-col gap-stack">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {outcomeIds.map((outcome) => (
        <Panel key={outcome} title={`${outcomes[outcome]} email`}>
          <p className="-mt-2 text-sm text-muted">
            Version {saved[outcome].version}. Saving a change makes a new version.
          </p>
          <FormField
            id={boxId(outcome, 'subject')}
            label="Subject"
            error={form.errorFor(boxId(outcome, 'subject'))}
          >
            <Input
              value={values[outcome].subject}
              autoComplete="off"
              onFocus={() => {
                lastPart.current[outcome] = 'subject';
              }}
              onChange={(event) => {
                edit(outcome, 'subject', event.currentTarget.value);
              }}
            />
          </FormField>
          <FormField
            id={boxId(outcome, 'body')}
            label="Text of the email"
            error={form.errorFor(boxId(outcome, 'body'))}
          >
            <Textarea
              rows={10}
              value={values[outcome].body}
              onFocus={() => {
                lastPart.current[outcome] = 'body';
              }}
              onChange={(event) => {
                edit(outcome, 'body', event.currentTarget.value);
              }}
            />
          </FormField>
          <MergeFieldButtons
            outcome={outcome}
            onInsert={(field) => {
              insert(outcome, field);
            }}
          />
        </Panel>
      ))}
      <FormFooter
        save="Save emails"
        pending={form.pending}
        back="Back to programme"
        backTo={programmePath(programmeId)}
        saved={done && 'Emails saved.'}
      />
    </form>
  );
}
