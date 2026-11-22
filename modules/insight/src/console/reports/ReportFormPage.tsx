// SPDX-License-Identifier: AGPL-3.0-or-later

import { warehouseTableNames } from '@pixel-scientists/domain/warehouse';
import {
  Button,
  CheckboxGroup,
  ErrorSummary,
  FormField,
  Input,
  Notice,
  PageHeader,
  RadioGroup,
  Select,
  Textarea,
  useCan,
  useLeaveGuard,
  useLoad,
  useNavigate,
  useSubmit,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { monitoringBreakdowns, reportKinds } from '../../contracts/index.ts';
import type { ReportDefinition } from '../../contracts/index.ts';
import { createReport, loadReport, updateReport } from '../api.ts';
import { breakdownLabels, plainName, reportKindLabels } from '../format.ts';
import { insightPath } from '../paths.ts';
import { columnsOf, draftOf, emptyDraft, inputOf } from './reportDraft.ts';
import type { Draft } from './reportDraft.ts';

const FIELDS = ['name', 'description', 'kind', 'source', 'measures', 'groupBy', 'filters'] as const;

function Form({ before }: { before: ReportDefinition | null }) {
  const initial = before === null ? emptyDraft('warehouse') : draftOf(before);
  const [draft, setDraft] = useState<Draft>(initial);
  const [savedId, setSavedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const set = (change: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...change }));
  };
  useLeaveGuard(savedId === null && JSON.stringify(draft) !== JSON.stringify(initial));
  useEffect(() => {
    if (savedId !== null) navigate(insightPath('report', { id: savedId }));
  }, [savedId, navigate]);

  const form = useSubmit(FIELDS, async () => {
    const body = inputOf(draft, before);
    const saved = before === null ? await createReport(body) : await updateReport(before.id, body);
    setSavedId(saved.id);
  });

  const warehouse = draft.kind === 'warehouse';
  const columns = columnsOf(draft.source);
  const kept =
    before?.kind === 'monitoring'
      ? Object.values(before.filters).find(
          (filter) => filter.field === 'programme' || filter.field === 'round',
        )
      : undefined;

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-2xl flex-col gap-5">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      {before === null ? (
        <RadioGroup
          legend="Kind of report"
          name="kind"
          id="kind"
          value={draft.kind}
          onValueChange={(kind) => {
            set({
              ...emptyDraft(kind === 'monitoring' ? 'monitoring' : 'warehouse'),
              name: draft.name,
              description: draft.description,
            });
          }}
          options={reportKinds.map((kind) => ({ value: kind, label: reportKindLabels[kind] }))}
        />
      ) : (
        <p className="text-body text-ink">
          <span className="font-medium">Kind:</span> {reportKindLabels[draft.kind]}. The kind of a
          report cannot change.
        </p>
      )}
      <FormField label="Name" id="name" error={form.errorFor('name')}>
        <Input
          name="name"
          value={draft.name}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
        />
      </FormField>
      <FormField label="Description" id="description" optional error={form.errorFor('description')}>
        <Textarea
          name="description"
          rows={3}
          value={draft.description}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
        />
      </FormField>
      {warehouse ? (
        <>
          <FormField label="Table to read" id="source" error={form.errorFor('source')}>
            <Select
              name="source"
              value={draft.source}
              onChange={(event) => {
                set({ source: event.target.value, measures: ['count'], groupBy: [] });
              }}
            >
              {warehouseTableNames.map((name) => (
                <option key={name} value={name}>
                  {plainName(name)}
                </option>
              ))}
            </Select>
          </FormField>
          <CheckboxGroup
            legend="Count or add up"
            name="measures"
            id="measures"
            hint="Choose from 1 to 10."
            error={form.errorFor('measures')}
            values={draft.measures}
            onValuesChange={(measures) => {
              set({ measures });
            }}
            options={[
              { value: 'count', label: 'Number of rows' },
              ...columns
                .filter(([, { type }]) => type === 'integer' || type === 'bigint')
                .map(([name]) => ({
                  value: `sum.${name}`,
                  label: `Sum of ${name.replaceAll('_', ' ')}`,
                })),
            ]}
          />
          <CheckboxGroup
            legend="Group by"
            name="groupBy"
            id="groupBy"
            hint="Choose up to 3 columns."
            error={form.errorFor('groupBy')}
            values={draft.groupBy}
            onValuesChange={(groupBy) => {
              set({ groupBy });
            }}
            options={columns.map(([name]) => ({ value: name, label: plainName(name) }))}
          />
          {before !== null && (
            <Notice tone="neutral" title="Filters stay as they are">
              Saving keeps this report's filters unchanged.
            </Notice>
          )}
        </>
      ) : (
        <>
          <FormField
            label="Question code"
            id="source"
            hint="Lower case letters, numbers and underscores, such as ethnic_group."
            error={form.errorFor('source')}
          >
            <Input
              name="source"
              spellCheck={false}
              value={draft.source}
              onChange={(event) => {
                set({ source: event.target.value });
              }}
            />
          </FormField>
          <FormField label="Break down by" id="groupBy" error={form.errorFor('groupBy')}>
            <Select
              name="groupBy"
              value={draft.groupBy[0] ?? ''}
              onChange={(event) => {
                set({ groupBy: event.target.value === '' ? [] : [event.target.value] });
              }}
            >
              <option value="">Nothing</option>
              {monitoringBreakdowns.map((breakdown) => (
                <option key={breakdown} value={breakdown}>
                  {breakdownLabels[breakdown]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Financial year"
            id="filters"
            optional
            hint="Count only this year, such as 2027."
            error={form.errorFor('filters')}
          >
            <Input
              name="filters"
              inputMode="numeric"
              value={draft.year}
              onChange={(event) => {
                set({ year: event.target.value });
              }}
            />
          </FormField>
          {kept !== undefined && (
            <Notice tone="neutral" title="One filter stays as it is">
              This report is filtered by one {kept.field}. Saving keeps that filter.
            </Notice>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          {before === null ? 'Create report' : 'Save changes'}
        </Button>
        <Button
          onClick={() => {
            navigate(
              before === null ? insightPath('reports') : insightPath('report', { id: before.id }),
            );
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Editing({ reportId }: { reportId: string }) {
  const { state, retry } = useLoad(loadReport, reportId);
  return (
    <WhenLoaded state={state} label="Loading the report" retry={retry}>
      {(report) => <Form before={report} />}
    </WhenLoaded>
  );
}

/** Makes a report, or changes the one named. Saving writes a new version on the server. */
export default function ReportFormPage({ reportId }: { reportId?: string }) {
  const canManage = useCan('insight.reports.manage');
  const title = reportId === undefined ? 'Create report' : 'Edit report';
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Reports', to: insightPath('reports') }, { label: title }]}
      />
      {!canManage ? (
        <Notice tone="neutral" icon="lock" title="You cannot set up reports">
          Ask an administrator at your funder to give you the role that sets up reports.
        </Notice>
      ) : reportId === undefined ? (
        <Form before={null} />
      ) : (
        <Editing reportId={reportId} />
      )}
    </div>
  );
}
