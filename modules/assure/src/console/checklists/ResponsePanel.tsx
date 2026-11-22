// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DateInput,
  EmptyState,
  ErrorSummary,
  FormField,
  Input,
  Panel,
  RadioGroup,
  Select,
  Tag,
  WhenLoaded,
  useCan,
  useLoad,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { yesNoValues } from '../../contracts/index.ts';
import type { ChecklistResponse } from '../../contracts/index.ts';
import { loadApplicationChecklists, loadResponse, saveResponse } from '../loaders.ts';
import { formatMoment, yesNoWords } from '../words.ts';
import { initial, toBody } from './answers.ts';
import type { Values } from './answers.ts';

const TEXT_LIMIT = 500;
const NO_FILES =
  'Adding a file to a checklist is not available yet. Answers you have already saved are kept.';

const fieldOf = (id: string, kind: 'value' | 'fileIds') => `answers.${id}.${kind}`;

function Answers({ applicationId, first }: { applicationId: string; first: ChecklistResponse }) {
  const [response, setResponse] = useState(first);
  const [values, setValues] = useState<Values>(() => initial(first));
  const [saved, setSaved] = useState(false);
  const { version } = response;

  const fields = version.items.map(({ id, kind }) =>
    fieldOf(id, kind === 'file' ? 'fileIds' : 'value'),
  );
  const form = useSubmit(fields, async () => {
    setSaved(false);
    const next = await saveResponse(
      { applicationId, checklistId: response.checklistId },
      toBody(response, values),
    );
    setResponse(next);
    setValues(initial(next));
    setSaved(true);
  });

  const set = (id: string, value: string) => {
    setSaved(false);
    setValues((current) => ({ ...current, [id]: value }));
  };

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-stack">
      <p className="text-muted">
        {`Answering version ${String(version.number)} of ${version.name}. A newer version does not change these questions.`}
        {response.savedAt === null
          ? ' Not saved yet.'
          : ` Saved ${formatMoment(response.savedAt)}.`}{' '}
        <Tag tone={response.complete ? 'success' : 'warning'}>
          {response.complete ? 'Complete' : 'Not complete'}
        </Tag>
      </p>
      <ErrorSummary key={form.attempt} errors={form.errors} />
      {version.items.map((item) => {
        const held = values[item.id];
        const text = typeof held === 'string' ? held : '';
        const hint = item.help === '' ? undefined : item.help;
        const label = item.required ? item.label : `${item.label} (optional)`;
        if (item.kind === 'yes_no') {
          const field = fieldOf(item.id, 'value');
          return (
            <RadioGroup
              key={item.id}
              legend={label}
              hint={hint}
              id={field}
              name={field}
              value={text}
              onValueChange={(value) => {
                set(item.id, value);
              }}
              options={yesNoValues.map((value) => ({ value, label: yesNoWords[value] }))}
              error={form.errorFor(field)}
            />
          );
        }
        if (item.kind === 'date') {
          const field = fieldOf(item.id, 'value');
          return (
            <DateInput
              key={item.id}
              legend={label}
              hint={hint}
              id={field}
              value={text}
              onChange={(value) => {
                set(item.id, value ?? '');
              }}
              error={form.errorFor(field)}
            />
          );
        }
        if (item.kind === 'short_text') {
          const field = fieldOf(item.id, 'value');
          return (
            <FormField
              key={item.id}
              label={label}
              id={field}
              hint={[hint, `${String(text.length)} of ${String(TEXT_LIMIT)} characters.`]
                .filter(Boolean)
                .join(' ')}
              error={form.errorFor(field)}
            >
              <Input
                value={text}
                maxLength={TEXT_LIMIT}
                onChange={(event) => {
                  set(item.id, event.target.value);
                }}
              />
            </FormField>
          );
        }
        const files = Array.isArray(held) ? held.length : 0;
        return (
          <FormField key={item.id} label={label} id={fieldOf(item.id, 'fileIds')} hint={hint}>
            <p>
              {files === 0
                ? NO_FILES
                : `${String(files)} ${files === 1 ? 'file' : 'files'} added. ${NO_FILES}`}
            </p>
          </FormField>
        );
      })}
      {saved && (
        <p role="status" className="font-medium text-success">
          Answers saved.
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          Save answers
        </Button>
      </div>
    </form>
  );
}

function ForOne({ applicationId, checklistId }: { applicationId: string; checklistId: string }) {
  const { state, retry } = useLoad(loadResponse, { applicationId, checklistId });
  return (
    <WhenLoaded state={state} label="Loading answers" retry={retry}>
      {(response) => (
        <Answers key={response.version.id} applicationId={applicationId} first={response} />
      )}
    </WhenLoaded>
  );
}

function Chooser({ applicationId }: { applicationId: string }) {
  const { state, retry } = useLoad(loadApplicationChecklists, applicationId);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Panel title="Due diligence checklist">
      <WhenLoaded state={state} label="Loading checklists" retry={retry}>
        {({ checklists }) => {
          const current = checklists.find((entry) => entry.checklistId === chosen) ?? checklists[0];
          if (current === undefined) {
            return (
              <EmptyState title="No checklists yet" headingLevel="h3">
                <p>Ask someone who manages checklists to create one. It then appears here.</p>
              </EmptyState>
            );
          }
          return (
            <>
              {checklists.length > 1 && (
                <FormField label="Checklist" id="checklist-choice">
                  <Select
                    value={current.checklistId}
                    onChange={(event) => {
                      setChosen(event.target.value);
                    }}
                  >
                    {checklists.map((entry) => (
                      <option key={entry.checklistId} value={entry.checklistId}>
                        {`${entry.name}${entry.complete ? ' (complete)' : ''}`}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
              <ForOne
                key={current.checklistId}
                applicationId={applicationId}
                checklistId={current.checklistId}
              />
            </>
          );
        }}
      </WhenLoaded>
    </Panel>
  );
}

/** An application's answers to its due diligence checklists. It takes only the application's id. */
export function ChecklistResponses({ applicationId }: { applicationId: string }) {
  const can = useCan('assure.checklists.complete');
  return can ? <Chooser applicationId={applicationId} /> : null;
}
