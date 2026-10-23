// SPDX-License-Identifier: AGPL-3.0-or-later

import { auditActionLabel } from '@pixel-scientists/domain/platform/audit-log';
import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';
import { Button, DataTable } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { actorName, changeCount, entityLabel, entityModule, formatWhen } from './words.ts';

interface AuditTableProps {
  events: readonly AuditEvent[];
  zone: string | null;
  onOpen: (event: AuditEvent) => void;
  onHelp: () => void;
}

const wrap = 'block min-w-32 max-w-72 whitespace-normal';

/** The events as a dense table, newest first. A row opens its details with Enter, or with its button. */
export function AuditTable({ events, zone, onOpen, onHelp }: AuditTableProps) {
  const columns: readonly Column<AuditEvent>[] = [
    {
      key: 'when',
      header: 'When',
      rowHeader: true,
      cell: (event) => (
        <span className="tabular-nums">{formatWhen(event.occurredAt, zone ?? undefined)}</span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (event) => (
        <span className={`${wrap} font-medium`}>{auditActionLabel(event.action)}</span>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      cell: (event) => (
        <span className={`${wrap} flex flex-col`}>
          {entityLabel(event.entityType)}
          <span className="text-sm text-muted">{entityModule(event.entityType)}</span>
        </span>
      ),
    },
    { key: 'actor', header: 'Who', cell: (event) => actorName(event.actor) },
    { key: 'changes', header: 'Changed fields', cell: changeCount },
    {
      key: 'details',
      header: <span className="sr-only">Details</span>,
      align: 'end',
      cell: (event) => (
        <Button
          variant="quiet"
          onClick={() => {
            onOpen(event);
          }}
        >
          View details{' '}
          <span className="sr-only">
            of {auditActionLabel(event.action).toLowerCase()},{' '}
            {formatWhen(event.occurredAt, zone ?? undefined)}
          </span>
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      caption="Events in the audit log, newest first"
      captionHidden
      columns={columns}
      rows={events}
      rowKey={(event) => event.id}
      onOpenRow={onOpen}
      onHelp={onHelp}
    />
  );
}
