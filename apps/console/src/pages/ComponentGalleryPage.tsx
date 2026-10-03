// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  LoadingState,
  PageHeading,
  Textarea,
  buttonClassName,
} from '@pixelgrant/ui';
import type { ErrorSummaryItem } from '@pixelgrant/ui';
import { useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

function fieldValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A form that fails the way real ones do, so the error pattern can be tried by keyboard. */
function ExampleForm() {
  const [errors, setErrors] = useState<ErrorSummaryItem[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const found: ErrorSummaryItem[] = [];
    if (fieldValue(data, 'name') === '') {
      found.push({ fieldId: 'example-name', message: 'Enter a programme name' });
    }
    if (!/^\S+@\S+\.\S+$/.test(fieldValue(data, 'email'))) {
      found.push({
        fieldId: 'example-email',
        message: 'Enter an email address in the format name@example.org',
      });
    }
    setErrors(found);
    setChecked(found.length === 0);
    setAttempt((count) => count + 1);
  }

  const message = (fieldId: string) => errors.find((error) => error.fieldId === fieldId)?.message;

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <ErrorSummary key={attempt} errors={errors} />
      <FormField id="example-name" label="Programme name" error={message('example-name')}>
        <Input name="name" autoComplete="off" />
      </FormField>
      <FormField
        id="example-email"
        label="Contact email address"
        hint="We use it to send reminders about deadlines."
        error={message('example-email')}
      >
        <Input name="email" type="email" autoComplete="email" spellCheck={false} />
      </FormField>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary">
          Check details
        </Button>
        <p role="status" className="text-body text-success">
          {checked && 'The details are valid. Nothing was saved, because this is an example.'}
        </p>
      </div>
    </form>
  );
}

/**
 * Every shared component in its main states, for checking them by eye and
 * with axe in a real browser. Development builds only.
 */
export default function ComponentGalleryPage() {
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>Component gallery</PageHeading>
      <p className="max-w-prose text-body text-muted">
        The shared components in their main states. This page is part of development builds only.
      </p>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Save programme</Button>
          <Button>Add reviewer</Button>
          <Button variant="danger">Delete draft</Button>
          <Button variant="quiet">Cancel changes</Button>
          <Button disabled>Release decisions</Button>
          <Link to="/" className={buttonClassName('secondary')}>
            Go to programmes
          </Link>
        </div>
      </Section>

      <Section title="Form fields">
        <div className="flex max-w-xl flex-col gap-4">
          <FormField label="Programme name">
            <Input autoComplete="off" />
          </FormField>
          <FormField label="Closing date" hint="For example, 1 April 2027">
            <Input autoComplete="off" />
          </FormField>
          <FormField label="Website" optional>
            <Input type="url" autoComplete="url" />
          </FormField>
          <FormField
            label="Round name"
            hint="Staff and reviewers see this name."
            error="Enter a round name"
          >
            <Input autoComplete="off" />
          </FormField>
          <FormField label="Summary" hint="Up to 500 words">
            <Textarea />
          </FormField>
        </div>
      </Section>

      <Section title="Error summary">
        <ExampleForm />
      </Section>

      <Section title="Empty and loading states">
        <EmptyState
          title="No applications yet"
          headingLevel="h3"
          action={<Button variant="primary">Copy programme link</Button>}
        >
          Share the programme link to start receiving applications.
        </EmptyState>
        <LoadingState label="Loading applications" className="rounded-lg bg-surface" />
      </Section>

      <Section title="Links between pages">
        <p className="text-body">
          <Link to="/does-not-exist">Open a page that does not exist</Link> to see the not found
          page.
        </p>
      </Section>
    </div>
  );
}
