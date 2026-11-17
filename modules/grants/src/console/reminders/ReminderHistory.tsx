// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reminders sent for a submission or a review assignment: what was due,
// when, and what happened, in words. No address and no email content ever
// reaches this screen, and nothing here sends, closes or changes anything
// (rule 9). The list is read only when the section is opened.

import { call } from '@pixel-scientists/domain/api';
import { Button, Panel, useCan, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';

import {
  listAssignmentReminders,
  listSubmissionReminders,
  reminderKinds,
  reminderOutcomes,
  reminderReasons,
} from '../../contracts/index.ts';
import type { ReminderHistory as History } from '../../contracts/index.ts';
import { formatMoment } from '../programme/format.ts';

/** The tenant's reminders are timed in UK time. */
const ZONE = 'Europe/London';

/** What the history of a submission or an assignment reads, defined once so a section reads only when opened. */
export const loadSubmissionReminders = (submissionId: string): Promise<History> =>
  call(listSubmissionReminders, { params: { submissionId } });

export const loadAssignmentReminders = (assignmentId: string): Promise<History> =>
  call(listAssignmentReminders, { params: { assignmentId } });

interface Source {
  load: (id: string) => Promise<History>;
  id: string;
}

function Entries({ load, id }: Source) {
  const { state, retry } = useLoad(load, id);
  return (
    <WhenLoaded state={state} label="Loading reminders" retry={retry}>
      {({ reminders }) =>
        reminders.length === 0 ? (
          <p className="text-body text-muted">No reminders have been due yet.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-2">
            {reminders.map((entry) => (
              <li key={`${entry.kind}-${entry.at}`} className="flex flex-col text-body text-ink">
                <span className="font-medium">{reminderKinds[entry.kind]}</span>
                <span className="text-muted">
                  {formatMoment(entry.at, ZONE)}. {reminderOutcomes[entry.outcome]}
                  {entry.reason !== null && `: ${reminderReasons[entry.reason].toLowerCase()}`}.
                </span>
              </li>
            ))}
          </ul>
        )
      }
    </WhenLoaded>
  );
}

/**
 * A closed section that reads the history when it is opened. Only members
 * who set up programmes see it, as the route requires.
 */
export function ReminderHistory({ load, id }: Source) {
  const [open, setOpen] = useState(false);
  if (!useCan('grants.programmes.manage')) return null;
  return (
    <Panel title="Reminders" headingLevel="h3">
      <p className="text-body text-muted">
        Reminders only remind. They never change an application or a review.
      </p>
      <Button
        className="self-start"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Hide reminders' : 'Show reminders'}
      </Button>
      {open && <Entries load={load} id={id} />}
    </Panel>
  );
}
