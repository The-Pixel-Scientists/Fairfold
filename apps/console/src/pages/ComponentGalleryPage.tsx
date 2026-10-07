// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  AuthenticatorKey,
  Button,
  Dialog,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Link,
  LoadingState,
  PageHeading,
  RadioGroup,
  Select,
  StepUpDialog,
  Textarea,
  buttonClassName,
} from '@pixel-scientists/ui';
import type { ErrorSummaryItem } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';

import {
  AnswerExample,
  ConditionalExample,
  EligibilityExample,
  EmptyQuestionsExample,
  ProblemQuestionsExample,
  SaveStatusExample,
} from './FormExamples.tsx';
import { DataExamples } from './gallery/DataExamples.tsx';
import { LayoutExamples } from './gallery/LayoutExamples.tsx';

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

/** A question with a few answers, and a list to choose from, so they can be tried by keyboard. */
function ChoiceExamples() {
  const [corners, setCorners] = useState('standard');
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <RadioGroup
        legend="Corners"
        name="corners"
        value={corners}
        onValueChange={setCorners}
        hint="Changes how rounded buttons and panels look."
        options={[
          { value: 'standard', label: 'Standard', hint: 'Small rounded corners.' },
          { value: 'rounded', label: 'Rounded', hint: 'Larger rounded corners.' },
          { value: 'square', label: 'Square' },
        ]}
      />
      <FormField label="Financial year starts in" hint="The month your financial year begins.">
        <Select defaultValue="4">
          <option value="1">January</option>
          <option value="4">April</option>
          <option value="10">October</option>
        </Select>
      </FormField>
    </div>
  );
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

/** The dialogs, each opened by a button, so the focus and keyboard behaviour can be tried by hand. */
function DialogExamples() {
  const [plain, setPlain] = useState(false);
  const [stepUp, setStepUp] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        onClick={() => {
          setPlain(true);
        }}
      >
        Open dialog
      </Button>
      <Button
        onClick={() => {
          setStepUp(true);
        }}
      >
        Open step-up dialog
      </Button>
      <Dialog
        open={plain}
        onOpenChange={setPlain}
        title="Switch funder"
        description="Choose the funder to work for. You will be taken to its console."
        actions={
          <>
            <Button
              onClick={() => {
                setPlain(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" data-autofocus>
              Switch to Eastmere Trust
            </Button>
          </>
        }
      />
      <StepUpDialog
        open={stepUp}
        onOpenChange={setStepUp}
        onConfirm={() =>
          Promise.reject(
            new ProblemError(401, 'Your password or code is not right. Check them and try again.'),
          )
        }
      />
    </div>
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
            Go to the start page
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

      <Section title="Choices">
        <ChoiceExamples />
      </Section>

      <Section title="Error summary">
        <ExampleForm />
      </Section>

      <Section title="Questions of every type">
        <EmptyQuestionsExample />
      </Section>

      <Section title="Questions with problems">
        <ProblemQuestionsExample />
      </Section>

      <Section title="Questions that come and go">
        <ConditionalExample />
      </Section>

      <Section title="Answers that stop an applicant">
        <EligibilityExample />
      </Section>

      <Section title="Answers to read">
        <AnswerExample />
      </Section>

      <Section title="Save status">
        <SaveStatusExample />
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

      <Section title="Dialogs">
        <DialogExamples />
      </Section>

      <Section title="Authenticator set-up key">
        <AuthenticatorKey
          secret="JBSWY3DPEHPK3PXP"
          uri="otpauth://totp/Example:ada@example.org?secret=JBSWY3DPEHPK3PXP&issuer=Example"
        />
      </Section>

      <Section title="Links between pages">
        <p className="text-body">
          <Link to="/does-not-exist">Open a page that does not exist</Link> to see the not found
          page.
        </p>
      </Section>

      <LayoutExamples />
      <DataExamples />
    </div>
  );
}
