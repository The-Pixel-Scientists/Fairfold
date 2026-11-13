// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { Button, FormField, Textarea } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import { UNEXPECTED } from '../../assessment/problems.ts';

export interface ComposeFormProps {
  label: string;
  hint: string;
  submitLabel: string;
  max: number;
  /** The shared body check: the schema's first message, or null when the text is fine. */
  check: (text: string) => string | null;
  /** Sends the text under `key`; rejects with the API's problem. */
  send: (text: string, key?: string) => Promise<void>;
  /** Controls after the field, told which `mentions` positions the server refused, and how to forget them. */
  children?: (refused: ReadonlySet<number>, clear: () => void) => ReactNode;
}

const MENTION = /^body\.mentions\.(\d+)$/;

/** Read with the field when focus returns to it, since the chips' own text is not announced. */
const REFUSED_MENTIONS =
  'Remove the people who cannot see this application, then add the note again.';

/** Words for a count that nears the limit, read out politely. */
const NEAR = 0.1;

/**
 * A body field and a send button. Nothing the person typed is lost on a
 * refusal, and a retry after a lost answer reuses the first attempt's
 * idempotency key, so it creates one record.
 */
export function ComposeForm({
  label,
  hint,
  submitLabel,
  max,
  check,
  send,
  children,
}: ComposeFormProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [refused, setRefused] = useState<ReadonlySet<number>>(new Set());
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const key = useRef<string | undefined>(undefined);
  const left = max - text.length;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const problem = check(text);
    setError(problem ?? undefined);
    setRefused(new Set());
    if (problem !== null) {
      field.current?.focus();
      return;
    }
    busy.current = true;
    try {
      await send(text, key.current);
      key.current = undefined;
      setText('');
    } catch (thrown) {
      if (!(thrown instanceof ProblemError)) {
        setError(UNEXPECTED);
      } else {
        const lost = thrown.status === 0 || thrown.status >= 500;
        key.current = lost ? (thrown.idempotencyKey ?? undefined) : undefined;
        const marks = thrown.errors
          .map((item) => MENTION.exec(item.field)?.[1])
          .filter((mark) => mark !== undefined)
          .map(Number);
        setRefused(new Set(marks));
        const own = thrown.errors.find((item) => !MENTION.test(item.field));
        setError(own?.message ?? (marks.length > 0 ? REFUSED_MENTIONS : thrown.detail));
      }
      field.current?.focus();
    } finally {
      busy.current = false;
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-3"
    >
      <FormField label={label} hint={hint} error={error}>
        <Textarea
          ref={field}
          rows={4}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            key.current = undefined;
          }}
        />
      </FormField>
      <p className="text-sm text-muted">
        {text.length} of {max} characters
      </p>
      <p role="status" className="sr-only">
        {left <= max * NEAR ? `${String(Math.max(left, 0))} characters left` : ''}
      </p>
      {children?.(refused, () => {
        setRefused(new Set());
      })}
      <div>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
