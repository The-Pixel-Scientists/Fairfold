// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  asProblem,
  Button,
  ErrorSummary,
  FormField,
  Input,
  useNavigate,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';

import type { Form, FormSettingsInput } from '../../contracts/index.ts';
import { formPath } from '../paths.ts';

const TITLE_ID = 'form-title';

/** A new form starts as a draft for people who sign in, with nothing else set. Settings come later. */
const start = (title: string): FormSettingsInput => ({
  title,
  description: '',
  respondents: 'signed_in',
  opensAt: null,
  closesAt: null,
  confirmationMessage: '',
});

/** Whether trying the same submission again with its key is safe: the request may not have arrived. */
const mayRetry = (error: unknown): error is ProblemError =>
  error instanceof ProblemError &&
  error.idempotencyKey !== null &&
  (error.status === 0 || error.status >= 500);

export interface CreateFormProps {
  initialTitle?: string;
  /** Says what the button does: "Create form", "Use this template". */
  submit: string;
  /** Sends the one idempotent create, with the key to reuse when the last try may not have arrived. */
  create: (body: FormSettingsInput, idempotencyKey: string | undefined) => Promise<Form>;
}

/** Asks only for a title, creates the form once and opens its builder. */
export function CreateForm({ initialTitle = '', submit, create }: CreateFormProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [problem, setProblem] = useState({ message: '', count: 0 });
  const [busy, setBusy] = useState(false);
  const retrying = useRef<{ title: string; key: string } | null>(null);

  async function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem((current) => ({ ...current, message: '' }));
    const key = retrying.current?.title === title ? retrying.current.key : undefined;
    try {
      const form = await create(start(title), key);
      navigate(formPath(form.id));
    } catch (error) {
      retrying.current = mayRetry(error) ? { title, key: error.idempotencyKey ?? '' } : null;
      const found = asProblem(error);
      const message =
        found?.errors[0]?.message ?? found?.detail ?? 'Something went wrong. Try again.';
      setProblem(({ count }) => ({ message, count: count + 1 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="flex max-w-xl flex-col gap-4"
    >
      <ErrorSummary
        key={problem.count}
        errors={problem.message === '' ? [] : [{ fieldId: TITLE_ID, message: problem.message }]}
      />
      <FormField
        label="Form title"
        hint="People see this at the top of the form."
        id={TITLE_ID}
        error={problem.message}
      >
        <Input
          name="title"
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </FormField>
      <div>
        <Button type="submit" variant="primary" aria-disabled={busy || undefined}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
