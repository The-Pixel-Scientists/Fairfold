// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';
import {
  Button,
  buttonClassName,
  EmptyState,
  Link,
  LoadingState,
  PageHeader,
  PageHeading,
  ShortcutsDialog,
  useCan,
  useNavigate,
  useSearch,
} from '@pixel-scientists/ui';
import type { ShortcutGroup } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { AuditTable } from './AuditTable.tsx';
import { EventDialog } from './EventDialog.tsx';
import { Filters } from './Filters.tsx';
import { auditLogPath } from './paths.ts';
import { filtersSchema, isFiltered, searchOf } from './query.ts';
import type { AuditFilters } from './query.ts';
import { useAuditEvents } from './useAuditEvents.ts';
import type { AuditRows } from './useAuditEvents.ts';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Show the details of the event' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

const count = (events: number) => `${String(events)} ${events === 1 ? 'event' : 'events'}`;

interface ResultsProps {
  rows: AuditRows;
  loadMore: () => Promise<string | null>;
  onShortcuts: () => void;
}

/** The events read so far, with a way to read older ones. */
function Results({ rows, loadMore, onShortcuts }: ResultsProps) {
  const table = useRef<HTMLDivElement>(null);
  const firstNew = useRef<number | null>(null);
  const [opened, setOpened] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = rows.events.length;

  // Once older events are in, focus goes to the first of them, so the person carries on from where the list grew.
  useEffect(() => {
    if (firstNew.current === null || shown <= firstNew.current) return;
    table.current?.querySelectorAll<HTMLElement>('tbody > tr[data-row]')[firstNew.current]?.focus();
    firstNew.current = null;
  }, [shown]);

  async function more() {
    if (loading) return;
    firstNew.current = shown;
    setLoading(true);
    setProblem(null);
    const failed = await loadMore();
    setLoading(false);
    if (failed !== null) {
      firstNew.current = null;
      setProblem(failed);
    }
  }

  return (
    <>
      <p role="status" className="text-body text-muted">
        {rows.nextCursor === null
          ? `Showing all ${count(shown)}, newest first.`
          : `Showing the newest ${count(shown)}. Load more to see older ones.`}
      </p>
      <div ref={table}>
        <AuditTable events={rows.events} zone={rows.zone} onOpen={setOpened} onHelp={onShortcuts} />
      </div>
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      {rows.nextCursor !== null && (
        <div>
          <Button
            aria-disabled={loading || undefined}
            onClick={() => {
              void more();
            }}
          >
            {loading ? 'Loading more events' : 'Load more events'}
          </Button>
        </div>
      )}
      <EventDialog
        event={opened}
        zone={rows.zone}
        onClose={() => {
          setOpened(null);
        }}
      />
    </>
  );
}

function AuditLog({ filters }: { filters: AuditFilters }) {
  const navigate = useNavigate();
  const { state, reload, loadMore } = useAuditEvents(filters);
  const [help, setHelp] = useState(false);
  const search = searchOf(filters);
  const filtered = isFiltered(filters);
  const clear = () => {
    navigate(auditLogPath());
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when, in your funder's account. Nobody can change or delete an entry."
        actions={
          <Button
            onClick={() => {
              setHelp(true);
            }}
          >
            Keyboard shortcuts
          </Button>
        }
      />
      <Filters
        key={`filters${search}`}
        filters={filters}
        onApply={(next) => {
          navigate(auditLogPath(searchOf(next)));
        }}
        onClear={clear}
      />
      {state.status === 'loading' && (
        <LoadingState label="Loading the audit log" className="rounded-lg bg-surface" />
      )}
      {state.status === 'failed' && (
        <EmptyState
          title="We could not load the audit log"
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={reload}>Try again</Button>
              {filtered && <Button onClick={clear}>Clear filters</Button>}
            </div>
          }
        >
          <p>{state.message}</p>
        </EmptyState>
      )}
      {state.status === 'ready' &&
        (state.value.events.length === 0 ? (
          <EmptyState
            title={filtered ? 'No events match these filters' : 'No events yet'}
            action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined}
          >
            <p>
              {filtered
                ? 'Every filter narrows the log, so an event has to match all of them. Widen the dates, or remove a filter, to see more.'
                : 'Events appear here as people use this account, such as when someone signs in or changes a setting.'}
            </p>
          </EmptyState>
        ) : (
          <Results
            key={`results${search}`}
            rows={state.value}
            loadMore={loadMore}
            onShortcuts={() => {
              setHelp(true);
            }}
          />
        ))}
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="These work when a row of the table has focus. Press Tab to reach the table, then Tab again to reach its first row."
      />
    </>
  );
}

function InvalidAddress() {
  return (
    <>
      <PageHeader title="Audit log" />
      <EmptyState
        title="These filters are not valid"
        action={
          <Link to={auditLogPath()} className={buttonClassName()}>
            Show the whole log
          </Link>
        }
      >
        <p>The address has a filter that does not exist or a value it cannot use.</p>
      </EmptyState>
    </>
  );
}

function Cannot() {
  return (
    <>
      <PageHeading>Audit log</PageHeading>
      <EmptyState title="You cannot read the audit log">
        <p>Ask an administrator at your funder to give you access.</p>
      </EmptyState>
    </>
  );
}

/** The funder's audit log for its administrators. The filters are in the address. */
export default function AuditLogPage() {
  const allowed = useCan('platform.audit.read');
  const search = useSearch(filtersSchema);
  return (
    <div className="flex flex-col gap-stack">
      {!allowed ? (
        <Cannot />
      ) : search.success ? (
        <AuditLog filters={search.data} />
      ) : (
        <InvalidAddress />
      )}
    </div>
  );
}
