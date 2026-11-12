// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { messageForIssue } from '@pixel-scientists/domain/platform';
import { retentionChangeSchema } from '@pixel-scientists/domain/platform/retention';
import type { RetentionPolicy } from '@pixel-scientists/domain/platform/retention';
import { Button, ErrorSummary, FormField, Input, formText, useSubmit } from '@pixel-scientists/ui';

import { useFocusFirst } from '../sso/useFocusFirst.ts';
import { periodWords, policyName } from './period.ts';

export interface ChangeFormProps {
  policy: RetentionPolicy;
  /** Saves the period, then the page closes the form. Throws the API's problem. */
  save: (days: number) => Promise<void>;
  onCancel: () => void;
}

/** Checks the days as the server will, so a slip is caught before anything is sent. */
function daysFrom(text: string): number {
  const parsed = retentionChangeSchema.safeParse({
    days: /^\d+$/.test(text.trim()) ? Number(text) : NaN,
  });
  if (parsed.success) return parsed.data.days;
  const message = parsed.error.issues[0] ? messageForIssue(parsed.error.issues[0]) : '';
  throw new ProblemError(400, message, { errors: [{ field: 'body.days', message }] });
}

/** The form to change how long one kind of data is kept. What was typed stays through step-up. */
export function ChangeForm({ policy, save, onCancel }: ChangeFormProps) {
  const form = useSubmit(['days'], (data) => save(daysFrom(formText(data, 'days'))));
  const first = useFocusFirst();
  const name = policyName(policy.labelKey);

  return (
    <form
      ref={first}
      noValidate
      onSubmit={form.onSubmit}
      aria-label={`Change period for ${name}`}
      className="flex max-w-md flex-col gap-4 rounded-lg border border-divider bg-surface p-gutter"
    >
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField
        label={`Days to keep ${name.toLowerCase()}`}
        id="days"
        hint={`Now ${periodWords(policy.days)}. The platform minimum is ${periodWords(policy.minimumDays)}.`}
        error={form.errorFor('days')}
      >
        <Input
          name="days"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={String(policy.days)}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          Save period
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
