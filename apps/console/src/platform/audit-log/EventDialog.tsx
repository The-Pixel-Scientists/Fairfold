// SPDX-License-Identifier: AGPL-3.0-or-later

import { auditActionLabel } from '@pixel-scientists/domain/platform/audit-log';
import type { AuditEvent } from '@pixel-scientists/domain/platform/audit-log';
import { Button, Dialog, SummaryList } from '@pixel-scientists/ui';

import {
  actorName,
  entityLabel,
  entityModule,
  fieldLabel,
  formatWhen,
  valueText,
} from './words.ts';

type Change = AuditEvent['changes'][string];

function Side({ name, change, side }: { name: string; change: Change; side: 'before' | 'after' }) {
  const value = change[side];
  return (
    <div>
      <dt className="text-sm font-medium text-muted">{name}</dt>
      <dd className="break-words">
        {value === undefined ? <span className="text-muted">Not recorded</span> : valueText(value)}
      </dd>
    </div>
  );
}

function Changes({ changes }: { changes: AuditEvent['changes'] }) {
  const fields = Object.entries(changes);
  if (fields.length === 0) {
    return <p className="text-body text-muted">This event did not change any fields.</p>;
  }
  return (
    <ul aria-label="Changed fields" className="flex flex-col divide-y divide-divider">
      {fields.map(([id, change]) => (
        <li key={id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <p className="text-body font-medium text-ink">
            {fieldLabel(id)}
            <span className="block font-mono text-xs font-normal break-all text-muted">{id}</span>
          </p>
          {change.before === undefined && change.after === undefined ? (
            <p className="text-body">Changed</p>
          ) : (
            <dl className="grid gap-x-4 gap-y-1 text-body sm:grid-cols-2">
              <Side name="Before" change={change} side="before" />
              <Side name="After" change={change} side="after" />
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

interface EventDialogProps {
  /** The event to show; null keeps the dialog closed. */
  event: AuditEvent | null;
  zone: string | null;
  onClose: () => void;
}

/** One event: when, what, who, and the fields it changed. */
export function EventDialog({ event, zone, onClose }: EventDialogProps) {
  return (
    <Dialog
      wide
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={event === null ? 'Event' : auditActionLabel(event.action)}
      actions={
        <Button variant="primary" data-autofocus onClick={onClose}>
          Close
        </Button>
      }
    >
      {event !== null && (
        <>
          <SummaryList
            items={[
              { term: 'When', value: formatWhen(event.occurredAt, zone ?? undefined) },
              { term: 'Who', value: actorName(event.actor) },
              {
                term: 'Entity',
                value: `${entityLabel(event.entityType)} (${entityModule(event.entityType)})`,
              },
              {
                term: 'Entity ID',
                value: <span className="font-mono text-sm break-all">{event.entityId}</span>,
              },
              {
                term: 'Event ID',
                value: <span className="font-mono text-sm break-all">{event.id}</span>,
              },
            ]}
          />
          <h3 className="text-body font-semibold text-ink">What changed</h3>
          <Changes changes={event.changes} />
        </>
      )}
    </Dialog>
  );
}
