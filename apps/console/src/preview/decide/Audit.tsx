// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Audit log. Every change, decision and sensitive read, kept
// append-only (rule 4), with what changed shown before and after.

import { Button, EmptyState, FormField, Input, PageHeader, Select, cx } from '@pixel-scientists/ui';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';

import { events, pageSize } from './audit-data.ts';
import type { AuditEvent } from './audit-data.ts';
import { formatWhen } from './format.ts';
import { Eyebrow, Icon, Notice } from './parts.tsx';

const people = [...new Set(events.map((event) => event.who))].sort();
const actions = [...new Set(events.map((event) => event.action))].sort();

const cell = 'px-3 py-2 whitespace-nowrap';

/** The log opens on the round's first day to the latest event. */
const FROM = '2027-01-12';
const TO = '2027-04-02';

function Changes({ event }: { event: AuditEvent }) {
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full max-w-2xl border-collapse text-body">
        <caption className="sr-only">
          What {event.action.toLowerCase()} changed, for {event.target}
        </caption>
        <thead>
          <tr className="border-b border-divider text-sm font-medium text-muted">
            <th scope="col" className="py-1.5 pr-4 text-start">
              Field
            </th>
            <th scope="col" className="py-1.5 pr-4 text-start">
              Before
            </th>
            <th scope="col" className="py-1.5 text-start">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {event.changes?.map((item) => (
            <tr key={item.field} className="border-b border-divider last:border-b-0">
              <th scope="row" className="py-1.5 pr-4 text-start font-medium">
                {item.field}
              </th>
              <td className="py-1.5 pr-4 text-muted line-through decoration-edge">{item.before}</td>
              <td className="py-1.5 font-medium text-ink">{item.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        Event <span className="font-mono">{event.id}</span>, recorded {formatWhen(event.at)} by{' '}
        {event.who}.
      </p>
    </div>
  );
}

function AuditTable({ rows }: { rows: readonly AuditEvent[] }) {
  const captionId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['evt_7Nm8h3']));

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="relative overflow-x-auto"
    >
      <table className="min-w-full border-collapse text-body">
        <caption id={captionId} className="sr-only">
          Events in the audit log, newest first
        </caption>
        <thead>
          <tr className="border-b border-edge/40 text-sm font-medium text-muted">
            <th scope="col" className={cx(cell, 'text-start')}>
              When
            </th>
            <th scope="col" className={cx(cell, 'text-start')}>
              Who
            </th>
            <th scope="col" className={cx(cell, 'text-start')}>
              Action
            </th>
            <th scope="col" className={cx(cell, 'text-start')}>
              Target
            </th>
            <th scope="col" className={cx(cell, 'text-end')}>
              <span className="sr-only">Change</span>
            </th>
          </tr>
        </thead>
        {rows.map((event) => {
          const expanded = open.has(event.id);
          const detailId = `${event.id}-change`;
          return (
            <tbody key={event.id} className="border-b border-divider">
              <tr
                className={cx(
                  'transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken/60',
                  expanded && 'bg-sunken/40',
                )}
              >
                <th
                  id={`${event.id}-when`}
                  tabIndex={-1}
                  scope="row"
                  className={cx(cell, 'text-start font-normal tabular-nums')}
                >
                  {formatWhen(event.at)}
                </th>
                <td className={cx(cell, event.who === 'System' && 'text-muted')}>{event.who}</td>
                <td className={cx(cell, 'font-medium')}>{event.action}</td>
                <td className={cx(cell, 'text-muted')}>{event.target}</td>
                <td className={cx(cell, 'text-end')}>
                  {event.changes && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      onClick={() => {
                        toggle(event.id);
                      }}
                      className="inline-flex min-h-target items-center gap-1 rounded-sm text-sm font-medium text-accent hover:underline"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        className={cx(
                          'size-3.5 transition-transform duration-(--motion-fast)',
                          expanded && 'rotate-90',
                        )}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 3.5 4.5 4.5L6 12.5" />
                      </svg>
                      {expanded ? 'Hide change' : 'Show change'}
                      <span className="sr-only">
                        {' '}
                        for {event.action.toLowerCase()}, {event.target}
                      </span>
                    </button>
                  )}
                </td>
              </tr>
              {event.changes && expanded && (
                <tr id={detailId} className="bg-sunken/40">
                  <td colSpan={5} className="px-3 pt-1 pb-4">
                    <Changes event={event} />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export default function Audit() {
  const [who, setWho] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState(FROM);
  const [to, setTo] = useState(TO);
  const [all, setAll] = useState(false);

  const rows = events.filter(
    (event) =>
      (who === '' || event.who === who) &&
      (action === '' || event.action === action) &&
      (from === '' || event.at.slice(0, 10) >= from) &&
      (to === '' || event.at.slice(0, 10) <= to),
  );
  const narrowed = who !== '' || action !== '' || from !== FROM || to !== TO;
  const shown = narrowed || all ? rows : rows.slice(0, pageSize);

  function clear() {
    setWho('');
    setAction('');
    setFrom(FROM);
    setTo(TO);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Eyebrow>
            <span>Northfield Foundation</span>
          </Eyebrow>
        }
        title="Audit log"
        description="Every change, decision and sensitive view in your account, with who did it and when."
        actions={<Button>Export audit log</Button>}
      />

      <Notice icon="lock" title="The log is append-only">
        Nobody, including owners, can edit or delete an entry. Entries leave the log only when their
        retention period ends, and each removal is logged.
      </Notice>

      <form
        aria-label="Filter the audit log"
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,13rem))_auto] lg:items-end"
      >
        <FormField label="Who">
          <Select
            value={who}
            onChange={(event) => {
              setWho(event.currentTarget.value);
            }}
          >
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person}>{person}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Action">
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.currentTarget.value);
            }}
          >
            <option value="">All actions</option>
            {actions.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="From">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
            }}
          />
        </FormField>
        <FormField label="To">
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.currentTarget.value);
            }}
          />
        </FormField>
        <Button variant="quiet" aria-disabled={narrowed ? undefined : 'true'} onClick={clear}>
          Clear filters
        </Button>
      </form>

      <section aria-labelledby="events" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="events" className="text-lg font-semibold tracking-tight text-ink">
            Events
          </h2>
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted">
            <Icon name="info" />
            {narrowed
              ? `${String(rows.length)} ${rows.length === 1 ? 'event matches' : 'events match'}, newest first.`
              : shown.length < rows.length
                ? `Showing the newest ${String(shown.length)} of ${String(rows.length)} events.`
                : `Showing all ${String(rows.length)} events, newest first.`}
          </p>
        </div>
        {rows.length > 0 ? (
          <AuditTable rows={shown} />
        ) : (
          <EmptyState
            title="No events match these filters"
            action={<Button onClick={clear}>Clear filters</Button>}
          >
            <p>Widen the dates, or choose a different person or action.</p>
          </EmptyState>
        )}
        {shown.length < rows.length && (
          <div>
            <Button
              variant="quiet"
              onClick={() => {
                flushSync(() => {
                  setAll(true);
                });
                document.getElementById(`${rows[pageSize]?.id ?? ''}-when`)?.focus();
              }}
            >
              Show {rows.length - shown.length} more events
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
