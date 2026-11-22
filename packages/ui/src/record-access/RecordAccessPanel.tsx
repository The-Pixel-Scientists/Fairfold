// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState } from '../EmptyState.tsx';
import { Panel } from '../layout/Panel.tsx';
import { Tag } from '../layout/Tag.tsx';
import { formatUkTime } from './time.ts';

export type RecordAccessReason = 'role' | 'team' | 'assigned' | 'break_glass';

/** One member who can reach the record, and why. Never an email. */
export interface RecordAccessEntry {
  membershipId: string;
  /** From the member's person record; null when it has no name yet. */
  name: string | null;
  reason: RecordAccessReason;
  /** The team that gives the reach, when the reason is `team`. */
  teamName?: string;
  /** When a live emergency access ends, when the reason is `break_glass`. */
  expiresAt?: string;
}

/** What the platform says about who can reach one record. */
export interface RecordAccess {
  entries: readonly RecordAccessEntry[];
}

export interface RecordAccessPanelProps {
  access: RecordAccess;
  /** The heading level, so the panel fits the page's outline. Defaults to h2. */
  headingLevel?: 'h2' | 'h3';
}

function why({ reason, teamName, expiresAt }: RecordAccessEntry): string {
  switch (reason) {
    case 'role':
      return 'Their role gives access to every record of this kind';
    case 'team':
      return teamName === undefined ? 'Through a team' : `Through the ${teamName} team`;
    case 'assigned':
      return 'Assigned to them';
    case 'break_glass':
      return expiresAt === undefined
        ? 'Emergency access'
        : `Emergency access until ${formatUkTime(expiresAt)} UK time`;
  }
}

/**
 * Who can reach a record and why, from the answer the platform gave for it.
 * It shows only what the answer carries: each member's display name and a
 * plain reason. Put it on staff pages only; a reviewer's page gets no panel.
 */
export function RecordAccessPanel({ access, headingLevel = 'h2' }: RecordAccessPanelProps) {
  return (
    <Panel title="Who can reach this record" headingLevel={headingLevel}>
      {access.entries.length === 0 ? (
        <EmptyState title="No one can reach this record" headingLevel="h3">
          <p>Assign it to a member or a team so someone can work on it.</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {access.entries.map((entry) => (
            <li
              key={`${entry.membershipId}-${entry.reason}-${entry.teamName ?? ''}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <span className="flex items-center gap-2 font-medium text-ink">
                {entry.name ?? <span className="font-normal text-muted">Not named yet</span>}
                {entry.reason === 'break_glass' && <Tag tone="warning">Emergency</Tag>}
              </span>
              <span className="text-body text-muted">{why(entry)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
