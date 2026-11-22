// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ValueHistoryEntry, ValueHistoryPage } from '@pixel-scientists/party/contracts';
import {
  Button,
  DataTable,
  Panel,
  WhenLoaded,
  asProblem,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { loadOrganisationHistory, loadPersonHistory } from './loaders.ts';
import { fieldWords, formatMoment } from './words.ts';

type Read = (id: string, cursor?: string) => Promise<ValueHistoryPage>;

const none = (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">Empty</span>
  </>
);

const value = (text: string | null) =>
  text === null ? none : <span className="block max-w-prose whitespace-pre-wrap">{text}</span>;

const columns: readonly Column<ValueHistoryEntry>[] = [
  { key: 'when', header: 'When', rowHeader: true, cell: (row) => formatMoment(row.changedAt) },
  { key: 'field', header: 'Detail', cell: (row) => fieldWords[row.fieldId] },
  { key: 'before', header: 'Before', cell: (row) => value(row.previousValue) },
  { key: 'after', header: 'After', cell: (row) => value(row.newValue) },
  {
    key: 'by',
    header: 'Changed by',
    cell: (row) => (row.changedBy === null ? 'The system' : 'A member of staff'),
  },
];

function Entries({ id, read, first }: { id: string; read: Read; first: ValueHistoryPage }) {
  const [entries, setEntries] = useState(first.entries);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function more() {
    if (cursor === null || pending) return;
    setPending(true);
    try {
      const page = await read(id, cursor);
      setEntries([...entries, ...page.entries]);
      setCursor(page.nextCursor);
      setProblem(null);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DataTable
        caption="Changes to details"
        captionHidden
        columns={columns}
        rows={entries}
        rowKey={(row) => `${row.changedAt}:${row.fieldId}:${row.newValue ?? ''}`}
        empty={<p className="text-muted">No details have changed since this record was made.</p>}
      />
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button onClick={() => void more()} aria-disabled={pending || undefined}>
            Show more changes
          </Button>
        </div>
      )}
    </>
  );
}

function Loaded({ id, read }: { id: string; read: Read }) {
  const { state, retry } = useLoad(read, id);
  return (
    <Panel title="Value history">
      <WhenLoaded state={state} label="Loading value history" retry={retry}>
        {(first) => <Entries id={id} read={read} first={first} />}
      </WhenLoaded>
    </Panel>
  );
}

/**
 * How a record's details have changed, newest first. Only members who can
 * manage records may read it, so for anyone else the section is not there.
 */
export function ValueHistory({ kind, id }: { kind: 'organisation' | 'person'; id: string }) {
  const allowed = useCan('party.records.manage');
  if (!allowed) return null;
  return (
    <Loaded id={id} read={kind === 'organisation' ? loadOrganisationHistory : loadPersonHistory} />
  );
}
