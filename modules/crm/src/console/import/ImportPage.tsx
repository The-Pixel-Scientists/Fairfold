// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  EmptyState,
  LoadingState,
  Link,
  Notice,
  PageHeader,
  Panel,
  RadioGroup,
  Tag,
  asProblem,
  SummaryList,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { importRowMessages } from '../../contracts/index.ts';
import type { ImportJob } from '../../contracts/index.ts';
import { useParam } from '../Gate.tsx';
import { PartyLink } from '../labels.tsx';
import { Needs } from '../Needs.tsx';
import { Outcome } from '../Outcome.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { CRM_PATH } from '../paths.ts';
import { useStepUp } from '../useStepUp.tsx';
import { confirm, loadJob, loadRows } from './api.ts';
import { counted, failureWords, importFieldWords, rowsWords, stateWords } from './words.ts';

type Row = Awaited<ReturnType<typeof loadRows>>['items'][number];
type Result = Awaited<ReturnType<typeof confirm>>;

const POLL_MS = 3000;
const UNEXPECTED = 'Something went wrong. Try again.';
const working = new Set<ImportJob['state']>(['queued', 'checking', 'importing']);

type Job =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; job: ImportJob };

/** The import's state from the server, read again every few seconds while it is working. */
function useJob(importId: string): { job: Job; reload: () => void } {
  const [job, setJob] = useState<Job>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      loadJob(importId).then(
        (value) => {
          if (!current) return;
          setJob({ status: 'ready', job: value });
          if (working.has(value.state)) timer = setTimeout(read, POLL_MS);
        },
        (error: unknown) => {
          if (current)
            setJob({ status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
        },
      );
    };
    read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [importId, attempt]);

  return {
    job,
    reload: () => {
      setJob({ status: 'loading' });
      setAttempt((count) => count + 1);
    },
  };
}

function errorLines(row: Row): string[] {
  return row.errors.map(
    ({ field, code }) =>
      `Row ${String(row.row)}, ${importFieldWords[field]}: ${importRowMessages[code]}`,
  );
}

const statusWords = { valid: 'Ready', error: 'Has errors', duplicate: 'Likely duplicate' } as const;

function rowColumns(target: ImportJob['target']): readonly Column<Row>[] {
  return [
    { key: 'row', header: 'Row', rowHeader: true, align: 'end', cell: (row) => String(row.row) },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Tag
          tone={row.status === 'valid' ? 'success' : row.status === 'error' ? 'danger' : 'warning'}
        >
          {statusWords[row.status]}
        </Tag>
      ),
    },
    {
      key: 'details',
      header: 'What to do',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          {errorLines(row).map((line) => (
            <span key={line}>{line}</span>
          ))}
          {row.duplicates.map((duplicate) => (
            <span key={duplicate.partyId}>
              Row {row.row} looks like <PartyLink kind={target} id={duplicate.partyId} />. Skip it,
              or add it as a new record.
            </span>
          ))}
        </span>
      ),
    },
  ];
}

function Preview({ job, onDone }: { job: ImportJob; onDone: (result: Result) => void }) {
  const paged = usePaged(loadRows, job.id);
  const step = useStepUp();
  const [duplicates, setDuplicates] = useState<'skip' | 'create'>('skip');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const key = useRef(crypto.randomUUID());
  const { rows } = job;
  const creating = rows.valid + (duplicates === 'create' ? rows.duplicates : 0);

  async function send() {
    if (sending.current || creating === 0) return;
    sending.current = true;
    setPending(true);
    try {
      const result = await step.run(() => confirm(job.id, duplicates, key.current));
      if (result !== null) onDone(result);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? UNEXPECTED);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack">
      <Panel title="Check the rows">
        <SummaryList
          items={[
            { term: 'Rows in the file', value: String(rows.total) },
            { term: 'Rows ready', value: String(rows.valid) },
            { term: 'Rows with errors', value: String(rows.withErrors) },
            { term: 'Likely duplicates', value: String(rows.duplicates) },
          ]}
        />
      </Panel>
      <PagedTable
        paged={paged}
        label="Loading rows"
        caption="Rows to check"
        columns={rowColumns(job.target)}
        rowKey={(row) => String(row.row)}
        empty={
          <EmptyState title="No rows to show">
            <p>The file has no rows. Upload a file with records below the header row.</p>
          </EmptyState>
        }
      />
      <Panel title="Import these records">
        <div className="flex flex-col gap-3">
          {rows.withErrors > 0 && (
            <p>{`Skip ${rowsWords(rows.withErrors)} with errors. Correct them in the file and upload it again to import them.`}</p>
          )}
          {rows.duplicates > 0 && (
            <RadioGroup
              legend="Likely duplicates"
              name="duplicates"
              value={duplicates}
              onValueChange={(value) => {
                setDuplicates(value as 'skip' | 'create');
              }}
              options={[
                {
                  value: 'skip',
                  label: `Skip ${rowsWords(rows.duplicates)} that look like existing records`,
                },
                { value: 'create', label: `Add ${rowsWords(rows.duplicates)} as new records` },
              ]}
            />
          )}
          <p className="text-muted">
            An import does not verify numbers, merge records or send anything.
          </p>
          {problem !== null && (
            <div role="alert">
              <Notice tone="danger" title="The records were not imported">
                {problem}
              </Notice>
            </div>
          )}
          <div>
            <Button
              variant="primary"
              onClick={() => void send()}
              aria-disabled={pending || creating === 0 || undefined}
            >
              {`Import ${counted(job.target, creating)}`}
            </Button>
          </div>
        </div>
      </Panel>
      {step.dialog}
    </div>
  );
}

function Finished({
  target,
  created,
  skipped,
}: {
  target: ImportJob['target'];
  created: number;
  skipped: number;
}) {
  return (
    <Outcome title={`Imported ${counted(target, created)}`}>
      <p>
        {`Skipped ${rowsWords(skipped)} with errors or that looked like existing records.`}{' '}
        <Link to={CRM_PATH}>Open records</Link> to see the new records.
      </p>
    </Outcome>
  );
}

function ImportView() {
  const importId = useParam('importId');
  const { job: state, reload } = useJob(importId);
  const [result, setResult] = useState<Result | null>(null);

  if (state.status === 'loading') return <LoadingState label="Loading the import" />;
  if (state.status === 'failed') {
    return (
      <EmptyState
        title="We could not load this import"
        action={<Button onClick={reload}>Try again</Button>}
      >
        <p>{state.message}</p>
      </EmptyState>
    );
  }
  const { job } = state;
  const done =
    (result === null
      ? null
      : { created: result.created, skipped: result.skippedErrors + result.skippedDuplicates }) ??
    (job.state === 'completed' && job.result !== null ? job.result : null);

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title={`Import ${targetNoun(job.target)}`}
        description="Check the rows from your file, then import them. Nothing is created until you confirm."
      />
      <p role="status" className="text-body font-medium text-ink">
        {stateWords[job.state]}
      </p>
      {job.state === 'failed' && (
        <Notice tone="danger" title="The file could not be used">
          {job.failure === null ? 'Upload the file again.' : failureWords[job.failure]}
        </Notice>
      )}
      {job.state === 'ready' && done === null && <Preview job={job} onDone={setResult} />}
      {done !== null && <Finished target={job.target} {...done} />}
    </div>
  );
}

const targetNoun = (target: ImportJob['target']) =>
  target === 'organisation' ? 'organisations' : 'people';

/** One import, from the server's state: checking, preview, confirm and result. */
export default function ImportPage() {
  return (
    <Needs permission="crm.imports.run">
      <ImportView />
    </Needs>
  );
}
