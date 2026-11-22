// SPDX-License-Identifier: AGPL-3.0-or-later

import { duplicateSignals } from '@pixel-scientists/party/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  FormField,
  Link,
  PageHeader,
  RadioGroup,
  Select,
  Tag,
  asProblem,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import type { DismissReason, DuplicatePair } from '../../contracts/index.ts';
import { PartyLink } from '../labels.tsx';
import { Needs } from '../Needs.tsx';
import { usePaged } from '../paged.ts';
import { PagedTable } from '../PagedTable.tsx';
import { comparePath } from '../paths.ts';
import { dismiss, loadDuplicates, noDuplicateFilters } from './api.ts';
import type { DuplicateFilters } from './api.ts';
import { bandWords, reasonsFor, reasonWords, signalWords } from './words.ts';

const pairKey = (pair: DuplicatePair) => `${pair.partyId}:${pair.otherPartyId}`;

function Dismissal({
  pair,
  onClose,
  onDone,
}: {
  pair: DuplicatePair;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<DismissReason | ''>('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const key = useRef(crypto.randomUUID());
  const sent = useRef(false);

  async function send() {
    if (sent.current) return;
    if (reason === '') {
      setProblem('Choose why these two records are not duplicates.');
      return;
    }
    sent.current = true;
    setPending(true);
    try {
      await dismiss(pair, reason, key.current);
      onDone();
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
      sent.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Mark as not duplicates"
      description="Nothing is merged or changed. These two records are not suggested again."
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void send()}
            aria-disabled={pending || undefined}
          >
            Mark as not duplicates
          </Button>
        </>
      }
    >
      <RadioGroup
        legend="Why are they not duplicates?"
        name="reason"
        value={reason}
        onValueChange={(value) => {
          setReason(value as DismissReason);
        }}
        options={reasonsFor(pair.kind).map((value) => ({ value, label: reasonWords[value] }))}
        error={problem ?? undefined}
      />
    </Dialog>
  );
}

function Duplicates() {
  const [filters, setFilters] = useState<DuplicateFilters>(noDuplicateFilters);
  const paged = usePaged(loadDuplicates, filters);
  const [dismissing, setDismissing] = useState<DuplicatePair | null>(null);

  const columns: readonly Column<DuplicatePair>[] = [
    {
      key: 'records',
      header: 'Records',
      rowHeader: true,
      cell: (pair) => (
        <span className="flex flex-col gap-0.5">
          <PartyLink kind={pair.kind} id={pair.partyId} />
          <PartyLink kind={pair.kind} id={pair.otherPartyId} />
        </span>
      ),
    },
    {
      key: 'why',
      header: 'Why they match',
      cell: (pair) => (
        <span className="flex flex-col items-start gap-1">
          <Tag tone={pair.band === 'high' ? 'warning' : 'neutral'}>{bandWords[pair.band]}</Tag>
          <span>{pair.signals.map((signal) => signalWords[signal]).join(', ')}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (pair) => (
        <span className="flex flex-wrap items-center gap-3">
          <Link to={comparePath(pair.kind, pair.partyId, pair.otherPartyId)}>Compare records</Link>
          <Button
            onClick={() => {
              setDismissing(pair);
            }}
          >
            Not a duplicate
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title="Possible duplicates"
        description="Records that look like the same organisation or person. Compare two records to decide. Nothing is merged until you confirm it."
      />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <FormField label="Kind">
          <Select
            value={filters.kind}
            onChange={(event) => {
              setFilters({ ...filters, kind: event.target.value as DuplicateFilters['kind'] });
            }}
          >
            <option value="any">Organisations and people</option>
            <option value="organisation">Organisations</option>
            <option value="person">People</option>
          </Select>
        </FormField>
        <FormField label="Why they match">
          <Select
            value={filters.signal}
            onChange={(event) => {
              setFilters({ ...filters, signal: event.target.value as DuplicateFilters['signal'] });
            }}
          >
            <option value="any">Any reason</option>
            {duplicateSignals.map((signal) => (
              <option key={signal} value={signal}>
                {signalWords[signal]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <PagedTable
        paged={paged}
        label="Loading possible duplicates"
        caption="Possible duplicates"
        columns={columns}
        rowKey={pairKey}
        empty={
          <EmptyState title="No possible duplicates">
            <p>
              Records that look alike appear here. Try another kind or reason, or check back after
              an import.
            </p>
          </EmptyState>
        }
      />
      {dismissing !== null && (
        <Dismissal
          pair={dismissing}
          onClose={() => {
            setDismissing(null);
          }}
          onDone={() => {
            paged.remove((pair) => pairKey(pair) === pairKey(dismissing));
            setDismissing(null);
          }}
        />
      )}
    </div>
  );
}

/** Pairs of records that may be one, strongest first. Staff decide; nothing merges here. */
export default function DuplicatesPage() {
  return (
    <Needs permission="crm.duplicates.review">
      <Duplicates />
    </Needs>
  );
}
