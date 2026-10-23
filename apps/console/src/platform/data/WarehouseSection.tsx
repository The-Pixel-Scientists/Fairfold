// SPDX-License-Identifier: AGPL-3.0-or-later

import { warehouseTableNames, warehouseTables } from '@pixel-scientists/domain/warehouse';
import { asProblem, Button, DataTable, Notice, Panel } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { useTenantSlug } from '../../tenant.ts';
import { fetchSnapshot, saveFile, snapshotFileName } from './download.ts';

/** How to load the snapshot, written for someone who works with data. */
const GUIDE_URL =
  'https://github.com/The-Pixel-Scientists/Fairfold/blob/main/docs/self-hosting/warehouse-snapshot.md';

const UNEXPECTED = 'Something went wrong. Try again.';

const included = [
  'Organisations, and people without their names or contact details',
  'Programmes, rounds, and the applications made to them, without their answers',
  'Scores, without reviewers’ comments',
  'The awards you have released, as commitments',
  'A date table that follows your financial year',
];

const leftOut = [
  'Personal details of any kind',
  'Anything an applicant wrote',
  'Decisions that have not been released',
];

interface Table {
  name: (typeof warehouseTableNames)[number];
  holds: string;
}

const tables: readonly Table[] = warehouseTableNames.map((name) => ({
  name,
  holds: warehouseTables[name].rows,
}));

const columns: readonly Column<Table>[] = [
  {
    key: 'name',
    header: 'Table',
    rowHeader: true,
    cell: (table) => <span className="font-mono text-sm">{table.name}</span>,
  },
  {
    key: 'holds',
    header: 'What it holds',
    cell: (table) => (
      <span className="block max-w-prose min-w-64 whitespace-normal">{table.holds}</span>
    ),
  },
];

function Points({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

type Result = { kind: 'saved'; file: string } | { kind: 'failed'; message: string };

/** The warehouse snapshot: what it holds and leaves out, and a button that saves it. */
export function WarehouseSection() {
  const slug = useTenantSlug();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const file = snapshotFileName(slug);
      saveFile(file, await fetchSnapshot());
      setResult({ kind: 'saved', file });
    } catch (error) {
      setResult({ kind: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Warehouse snapshot">
      <p className="max-w-prose text-body text-ink">
        One SQL file with a copy of your data as it stands now. Load it into PostgreSQL 16 or later
        with psql to ask your own questions. Each download is recorded in the audit log.
      </p>
      <div className="grid gap-x-12 gap-y-4 md:grid-cols-2">
        <Points title="In the snapshot" items={included} />
        <Points title="Left out" items={leftOut} />
      </div>
      <details className="group">
        <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 text-muted transition-transform duration-(--motion-fast) group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
          Show the {tables.length} tables
        </summary>
        <div className="pt-2">
          <DataTable
            caption="Tables in the warehouse snapshot"
            captionHidden
            columns={columns}
            rows={tables}
            rowKey={(table) => table.name}
          />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="primary"
          aria-disabled={busy || undefined}
          onClick={() => {
            void download();
          }}
        >
          Download warehouse snapshot
        </Button>
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">
          How to load the snapshot<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div role="status">
        {busy && <p className="text-body text-muted">Making the warehouse snapshot</p>}
        {!busy && result?.kind === 'saved' && (
          <Notice tone="success" title={`Saved ${result.file}`}>
            Load it with psql. The guide shows how.
          </Notice>
        )}
      </div>
      {!busy && result?.kind === 'failed' && (
        <div role="alert">
          <Notice tone="danger" title="We could not make the snapshot">
            {result.message}
          </Notice>
        </div>
      )}
    </Panel>
  );
}
