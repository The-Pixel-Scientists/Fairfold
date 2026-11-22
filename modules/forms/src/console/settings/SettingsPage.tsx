// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import {
  asProblem,
  Button,
  ErrorSummary,
  FormField,
  Input,
  PageHeader,
  RadioGroup,
  Textarea,
  useLoad,
  WhenLoaded,
  NotFoundPage,
} from '@pixel-scientists/ui';
import type { ErrorSummaryItem } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import {
  getForm,
  RETENTION_MONTHS,
  respondentOptions,
  updateFormRetention,
  updateFormSettings,
} from '../../contracts/index.ts';
import type { Form, Respondents } from '../../contracts/index.ts';
import { fromUkInput, toUkInput } from '../format.ts';
import { FormsPage, orMissing, useParam } from '../Page.tsx';
import { FORMS_PATH, formPath } from '../paths.ts';
import { respondentWords } from '../words.ts';
import { useStepUp } from './useStepUp.tsx';

const loadForm = (formId: string) => orMissing(call(getForm, { params: { formId } }));

const UNEXPECTED = 'Something went wrong. Try again.';

/** Where each problem is: the control a server field name such as `body.closesAt` is about. */
function controlOf(field: string): string {
  return `settings-${field.replace(/^body\./, '').split('.')[0] ?? ''}`;
}

/** What a failed call says, by control, in the words of the contract's catalogue. */
function problemsOf(error: unknown): ErrorSummaryItem[] {
  const found = asProblem(error);
  if (found === null) return [{ fieldId: 'settings-title', message: UNEXPECTED }];
  if (found.errors.length === 0) return [{ fieldId: 'settings-title', message: found.detail }];
  return found.errors.map(({ field, message }) => ({ fieldId: controlOf(field), message }));
}

const messageAt = (problems: readonly ErrorSummaryItem[], field: string) =>
  problems.find(({ fieldId }) => fieldId === `settings-${field}`)?.message;

/** The time a box holds, as UTC for the API, or null when it is empty. A box with text that is not a time is a mistake. */
function momentOf(local: string): string | null | undefined {
  if (local === '') return null;
  return fromUkInput(local) ?? undefined;
}

function Settings({ form: loaded }: { form: Form }) {
  const [form, setForm] = useState(loaded);
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [respondents, setRespondents] = useState<Respondents>(form.respondents);
  const [opens, setOpens] = useState(toUkInput(form.opensAt));
  const [closes, setCloses] = useState(toUkInput(form.closesAt));
  const [confirmation, setConfirmation] = useState(form.confirmationMessage);
  const [problems, setProblems] = useState<{ items: ErrorSummaryItem[]; count: number }>({
    items: [],
    count: 0,
  });
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    const opensAt = momentOf(opens);
    const closesAt = momentOf(closes);
    setSaved('');
    if (opensAt === undefined || closesAt === undefined) {
      const field = opensAt === undefined ? 'opensAt' : 'closesAt';
      setProblems(({ count }) => ({
        items: [{ fieldId: `settings-${field}`, message: 'Enter a date and a time.' }],
        count: count + 1,
      }));
      return;
    }
    setBusy(true);
    try {
      setForm(
        await call(updateFormSettings, {
          params: { formId: form.id },
          body: {
            title,
            description,
            respondents,
            opensAt,
            closesAt,
            confirmationMessage: confirmation,
          },
        }),
      );
      setProblems(({ count }) => ({ items: [], count }));
      setSaved('Settings saved.');
    } catch (error) {
      setProblems(({ count }) => ({ items: problemsOf(error), count: count + 1 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void save(event)}
      className="flex max-w-2xl flex-col gap-5"
    >
      <ErrorSummary key={problems.count} errors={problems.items} />
      <FormField label="Title" id="settings-title" error={messageAt(problems.items, 'title')}>
        <Input
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </FormField>
      <FormField
        label="Description"
        optional
        hint="People see this under the title."
        id="settings-description"
        error={messageAt(problems.items, 'description')}
      >
        <Textarea
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </FormField>
      <RadioGroup
        legend="Who can answer"
        name="respondents"
        id="settings-respondents"
        value={respondents}
        onValueChange={(value) => {
          setRespondents(value as Respondents);
        }}
        options={respondentOptions.map((value) => ({ value, label: respondentWords[value] }))}
        hint="Forms that anyone can answer cannot ask for files or answers counted only in totals."
        error={messageAt(problems.items, 'respondents')}
      />
      <FormField
        label="Opens"
        optional
        hint="In UK time. Leave empty to open when you publish."
        id="settings-opensAt"
        error={messageAt(problems.items, 'opensAt')}
      >
        <Input
          type="datetime-local"
          value={opens}
          onChange={(event) => {
            setOpens(event.target.value);
          }}
        />
      </FormField>
      <FormField
        label="Closes"
        optional
        hint="In UK time. Leave empty to keep the form open."
        id="settings-closesAt"
        error={messageAt(problems.items, 'closesAt')}
      >
        <Input
          type="datetime-local"
          value={closes}
          onChange={(event) => {
            setCloses(event.target.value);
          }}
        />
      </FormField>
      <FormField
        label="Confirmation message"
        optional
        hint="People see this after they send their answers."
        id="settings-confirmationMessage"
        error={messageAt(problems.items, 'confirmationMessage')}
      >
        <Textarea
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" aria-disabled={busy || undefined}>
          Save settings
        </Button>
        <p role="status" className="text-body text-muted">
          {saved}
        </p>
      </div>
    </form>
  );
}

function Retention({ form }: { form: Form }) {
  const [months, setMonths] = useState(String(form.retentionMonths));
  const [problem, setProblem] = useState({ message: '', count: 0 });
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const step = useStepUp();

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaved('');
    try {
      const changed = await step.run(() =>
        call(updateFormRetention, {
          params: { formId: form.id },
          body: { retentionMonths: Number(months) },
        }),
      );
      if (changed !== null) {
        setProblem(({ count }) => ({ message: '', count }));
        setSaved(`Responses are kept for ${String(changed.retentionMonths)} months.`);
      }
    } catch (error) {
      const found = asProblem(error);
      const message = found?.errors[0]?.message ?? found?.detail ?? UNEXPECTED;
      setProblem(({ count }) => ({ message, count: count + 1 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="retention-heading" className="flex max-w-2xl flex-col gap-3">
      <h2 id="retention-heading" className="text-lg font-semibold tracking-tight text-ink">
        How long responses are kept
      </h2>
      <form noValidate onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
        <ErrorSummary
          key={problem.count}
          errors={
            problem.message === ''
              ? []
              : [{ fieldId: 'retention-months', message: problem.message }]
          }
        />
        <FormField
          label="Months to keep responses"
          hint={`From ${String(RETENTION_MONTHS.min)} to ${String(RETENTION_MONTHS.max)}. You confirm it is you before this changes.`}
          id="retention-months"
          error={problem.message}
        >
          <Input
            inputMode="numeric"
            className="max-w-32"
            value={months}
            onChange={(event) => {
              setMonths(event.target.value);
            }}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" aria-disabled={busy || undefined}>
            Change retention
          </Button>
          <p role="status" className="text-body text-muted">
            {saved}
          </p>
        </div>
      </form>
      {step.dialog}
    </section>
  );
}

function Loader({ formId }: { formId: string }) {
  const { state, retry } = useLoad(loadForm, formId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Form settings" />}
      <WhenLoaded state={state} label="Loading settings" retry={retry}>
        {(form) =>
          form === null ? (
            <NotFoundPage />
          ) : (
            <>
              <PageHeader
                breadcrumbs={[
                  { label: 'Forms', to: FORMS_PATH },
                  { label: form.title, to: formPath(form.id) },
                  { label: 'Settings' },
                ]}
                title="Form settings"
                description="Who can answer, when the form is open, and how long responses are kept."
              />
              <Settings form={form} />
              <Retention form={form} />
            </>
          )
        }
      </WhenLoaded>
    </>
  );
}

export default function SettingsPage() {
  return (
    <FormsPage>
      <Loader formId={useParam('formId')} />
    </FormsPage>
  );
}
