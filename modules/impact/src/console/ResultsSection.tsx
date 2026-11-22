// SPDX-License-Identifier: AGPL-3.0-or-later

import { call, ProblemError } from '@pixel-scientists/domain/api';
import type { FieldProblem } from '@pixel-scientists/domain/platform';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  LoadingState,
  Select,
  Textarea,
  useSubmit,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { createResult, removeResult, updateResult } from '../contracts/index.ts';
import type { Framework, Result, ResultPage } from '../contracts/index.ts';
import { figureIn, periodProblems, refuse } from './forms.ts';
import { loadResult, loadResults } from './loaders.ts';
import { FormDialog, RemoveDialog, RowButton, Section } from './Page.tsx';
import { naming, topField } from './problems.ts';
import { figureLabel, figureText, formatFigure, formatPeriod, sourceWords } from './words.ts';

type Row = ResultPage['results'][number];

/** `body.evidence.1.caption` is the caption box of the second file. */
function boxFor(field: string): string {
  const index = /^body\.evidence\.(\d+)\./.exec(field)?.[1];
  return index === undefined ? topField(field) : `evidence-${index}-caption`;
}

/** Records a result or, given one, corrects its figure, note and the captions of its evidence. */
function ResultDialog({
  framework,
  result,
  onClose,
  onSaved,
}: {
  framework: Framework;
  result?: Result;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [indicatorId, setIndicatorId] = useState(result?.indicatorId ?? '');
  const [periodStart, setPeriodStart] = useState(result?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(result?.periodEnd ?? '');
  const indicator = framework.indicators[indicatorId];
  const [value, setValue] = useState(
    result === undefined || indicator === undefined ? '' : figureText(indicator.unit, result.value),
  );
  const [note, setNote] = useState(result?.note ?? '');
  const [evidence, setEvidence] = useState(result?.evidence ?? []);

  const form = useSubmit(
    [
      'indicatorId',
      'periodStart',
      'periodEnd',
      'value',
      'note',
      ...evidence.map((_, index) => `evidence-${String(index)}-caption`),
    ],
    naming(boxFor, async () => {
      const problems: FieldProblem[] = [];
      if (indicator === undefined) {
        problems.push({ field: 'indicatorId', message: 'Choose an indicator.' });
      }
      if (result === undefined) problems.push(...periodProblems(periodStart, periodEnd));
      const figure = figureIn('value', indicator?.unit ?? 'number', value, problems);
      refuse(problems);
      if (result === undefined) {
        await call(createResult, {
          body: {
            frameworkId: framework.id,
            indicatorId,
            programmeId: null,
            periodStart,
            periodEnd,
            value: figure,
            note,
            evidence: [],
          },
        });
      } else {
        await call(updateResult, {
          params: { resultId: result.id },
          body: { value: figure, note, evidence },
        });
      }
      onSaved();
    }),
  );

  return (
    <FormDialog
      title={result === undefined ? 'Record a result' : 'Correct result'}
      description={
        result === undefined
          ? 'A result is the figure you measured for an indicator over a period.'
          : `${indicator?.name ?? ''}, ${formatPeriod(result.periodStart, result.periodEnd)}`
      }
      submit={result === undefined ? 'Record result' : 'Save result'}
      form={form}
      onClose={onClose}
    >
      {result === undefined && (
        <>
          <FormField id="indicatorId" label="Indicator" error={form.errorFor('indicatorId')}>
            <Select
              value={indicatorId}
              onChange={(event) => {
                setIndicatorId(event.currentTarget.value);
              }}
            >
              <option value="">Choose an indicator</option>
              {Object.entries(framework.indicators).map(([id, { name }]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="periodStart" label="Period starts" error={form.errorFor('periodStart')}>
              <Input
                type="date"
                value={periodStart}
                onChange={(event) => {
                  setPeriodStart(event.currentTarget.value);
                }}
              />
            </FormField>
            <FormField id="periodEnd" label="Period ends" error={form.errorFor('periodEnd')}>
              <Input
                type="date"
                value={periodEnd}
                onChange={(event) => {
                  setPeriodEnd(event.currentTarget.value);
                }}
              />
            </FormField>
          </div>
        </>
      )}
      <FormField
        id="value"
        label={figureLabel('Result', indicator?.unit)}
        error={form.errorFor('value')}
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </FormField>
      <FormField
        id="note"
        label="Note"
        optional
        hint="How you measured it, or anything a reader should know."
        error={form.errorFor('note')}
      >
        <Textarea
          rows={3}
          value={note}
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
        />
      </FormField>
      {evidence.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-body font-medium text-ink">Evidence</legend>
          {evidence.map((item, index) => {
            const at = String(index + 1);
            return (
              <div key={item.fileId} className="flex flex-col gap-1">
                <FormField
                  id={`evidence-${String(index)}-caption`}
                  label={`Caption for file ${at}`}
                  error={form.errorFor(`evidence-${String(index)}-caption`)}
                >
                  <Input
                    value={item.caption}
                    autoComplete="off"
                    onChange={(event) => {
                      setEvidence(
                        evidence.map((entry, position) =>
                          position === index
                            ? { ...entry, caption: event.currentTarget.value }
                            : entry,
                        ),
                      );
                    }}
                  />
                </FormField>
                <div>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setEvidence(evidence.filter((_, position) => position !== index));
                    }}
                  >
                    Remove file {at}
                  </Button>
                </div>
              </div>
            );
          })}
        </fieldset>
      )}
    </FormDialog>
  );
}

/** Reads the whole result, with its note and evidence, before it can be corrected. */
function CorrectResult({
  framework,
  resultId,
  onClose,
  onSaved,
}: {
  framework: Framework;
  resultId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    loadResult(resultId).then(setResult, (error: unknown) => {
      setProblem(error instanceof ProblemError ? error.detail : 'Something went wrong. Try again.');
    });
  }, [resultId]);
  if (result !== null) {
    return (
      <ResultDialog framework={framework} result={result} onClose={onClose} onSaved={onSaved} />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Correct result"
      actions={<Button onClick={onClose}>Cancel</Button>}
    >
      {problem === null ? (
        <LoadingState label="Loading the result" />
      ) : (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
    </Dialog>
  );
}

type Open = { kind: 'new' } | { kind: 'correct' | 'remove'; row: Row } | null;

/** A framework's results, latest period first a page at a time, with a way to record, correct and remove them for a member who may. */
export function ResultsSection({
  framework,
  canChange,
  changed,
}: {
  framework: Framework;
  canChange: boolean;
  /** Called after a result is recorded, corrected or removed, so the progress can be read again. */
  changed: () => Promise<void>;
}) {
  const [indicatorId, setIndicatorId] = useState('');
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const [reads, setReads] = useState(0);
  const refresh = () => {
    setReads((count) => count + 1);
  };
  const words = (error: unknown) =>
    error instanceof ProblemError ? error.detail : 'Something went wrong. Try again.';

  // Reads the first page again for another indicator, or after a change, keeping the rows shown until it arrives.
  useEffect(() => {
    let current = true;
    loadResults(framework.id, indicatorId, null).then(
      (page) => {
        if (!current) return;
        setRows(page.results);
        setNext(page.nextCursor);
        setProblem(null);
      },
      (error: unknown) => {
        if (current) setProblem(words(error));
      },
    );
    return () => {
      current = false;
    };
  }, [framework.id, indicatorId, reads]);

  async function showMore(cursor: string) {
    setMore(true);
    try {
      const page = await loadResults(framework.id, indicatorId, cursor);
      setRows((before) => [...(before ?? []), ...page.results]);
      setNext(page.nextCursor);
    } catch (error) {
      setProblem(words(error));
    } finally {
      setMore(false);
    }
  }

  const close = () => {
    setOpen(null);
  };
  const saved = async () => {
    close();
    refresh();
    await changed();
  };

  const nameOf = (row: Row) => framework.indicators[row.indicatorId]?.name ?? '';
  const columns: readonly Column<Row>[] = [
    { key: 'indicator', header: 'Indicator', rowHeader: true, cell: nameOf },
    {
      key: 'period',
      header: 'Period',
      cell: (row) => formatPeriod(row.periodStart, row.periodEnd),
    },
    {
      key: 'value',
      header: 'Result',
      align: 'end',
      cell: (row) => {
        const unit = framework.indicators[row.indicatorId]?.unit;
        return unit === undefined ? row.value : formatFigure(unit, row.value);
      },
    },
    { key: 'source', header: 'Source', cell: (row) => sourceWords[row.source] },
    {
      key: 'evidence',
      header: 'Evidence',
      align: 'end',
      cell: (row) => (row.evidenceCount === 1 ? '1 file' : `${String(row.evidenceCount)} files`),
    },
    ...(canChange
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (row: Row) => {
              const name = `result for ${nameOf(row)}, ${formatPeriod(row.periodStart, row.periodEnd)}`;
              return (
                <span className="flex gap-1">
                  <RowButton
                    label="Correct"
                    target={name}
                    onClick={() => {
                      setOpen({ kind: 'correct', row });
                    }}
                  />
                  <RowButton
                    label="Remove"
                    target={name}
                    onClick={() => {
                      setOpen({ kind: 'remove', row });
                    }}
                  />
                </span>
              );
            },
          },
        ]
      : []),
  ];

  const hasIndicators = Object.keys(framework.indicators).length > 0;
  return (
    <Section
      title="Results"
      action={
        canChange &&
        hasIndicators && (
          <Button
            onClick={() => {
              setOpen({ kind: 'new' });
            }}
          >
            Record a result
          </Button>
        )
      }
    >
      {hasIndicators && (
        <div className="max-w-sm">
          <FormField id="results-indicator" label="Show results for">
            <Select
              value={indicatorId}
              onChange={(event) => {
                setRows(null);
                setIndicatorId(event.currentTarget.value);
              }}
            >
              <option value="">All indicators</option>
              {Object.entries(framework.indicators).map(([id, { name }]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      )}
      {problem !== null ? (
        <EmptyState
          title="We could not load the results"
          action={
            <Button
              onClick={() => {
                setRows(null);
                setProblem(null);
                refresh();
              }}
            >
              Try again
            </Button>
          }
        >
          <p>{problem}</p>
        </EmptyState>
      ) : rows === null ? (
        <LoadingState label="Loading results" className="rounded-lg bg-surface" />
      ) : rows.length === 0 ? (
        <EmptyState title="No results yet">
          <p>
            {!hasIndicators
              ? 'Add an indicator to the framework first. Then you can record results for it.'
              : canChange
                ? 'Record a result when you have measured an indicator for a period. Progress towards each target updates as you add them.'
                : 'Results appear here once someone who records results adds them.'}
          </p>
        </EmptyState>
      ) : (
        <>
          <DataTable
            caption="Results"
            captionHidden
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
          />
          {next !== null && (
            <div>
              <Button
                aria-disabled={more || undefined}
                onClick={() => {
                  if (more) return;
                  void showMore(next);
                }}
              >
                Show more results
              </Button>
            </div>
          )}
        </>
      )}
      {open?.kind === 'new' && (
        <ResultDialog framework={framework} onClose={close} onSaved={() => void saved()} />
      )}
      {open?.kind === 'correct' && (
        <CorrectResult
          framework={framework}
          resultId={open.row.id}
          onClose={close}
          onSaved={() => void saved()}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          title="Remove this result?"
          description={`${nameOf(open.row)}, ${formatPeriod(open.row.periodStart, open.row.periodEnd)}. Only remove a result that was recorded by mistake.`}
          submit="Remove result"
          onClose={close}
          action={async () => {
            await call(removeResult, { params: { resultId: open.row.id } });
            await saved();
          }}
        />
      )}
    </Section>
  );
}
