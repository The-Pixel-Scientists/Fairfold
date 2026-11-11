// SPDX-License-Identifier: AGPL-3.0-or-later

import { identifierSchemes, legalForms } from '@pixel-scientists/party/contracts';
import type { OrganisationSnapshot } from '@pixel-scientists/party/contracts';
import { Link, Panel, SummaryList, Tag } from '@pixel-scientists/ui';

import { formatMoment } from '../../programme/format.ts';
import { changedSince, listed } from './snapshot.ts';
import type { CurrentRecord } from './snapshot.ts';

export interface SnapshotPanelProps {
  /** Null for a draft, or an application submitted before snapshots were taken. */
  snapshot: OrganisationSnapshot | null;
  /** The organisation's record now, when the page has it. */
  current?: CurrentRecord;
  /** Where the current record is, when there is a page for it. */
  currentHref?: string;
  timeZone?: string;
}

/**
 * The organisation as it was when the application was submitted, read only.
 * Where the record has changed since, it says what changed and links to the
 * current record; it never shows the two merged.
 */
export function SnapshotPanel({ snapshot, current, currentHref, timeZone }: SnapshotPanelProps) {
  if (snapshot === null) {
    return (
      <Panel title="Organisation details as submitted">
        <p className="text-body text-muted">
          No snapshot was taken for this application, so there are no details as submitted. The
          organisation panel shows its record now.
        </p>
      </Panel>
    );
  }
  const changed = current === undefined ? [] : changedSince(snapshot, current);
  const { registeredAddress: address } = snapshot;
  return (
    <Panel title="Organisation details as submitted">
      <p role="status" className="text-body text-ink empty:hidden">
        {changed.length > 0 &&
          `The organisation's ${listed(changed)} ${changed.length === 1 ? 'has' : 'have'} changed since this was submitted.`}
      </p>
      {changed.length > 0 && currentHref !== undefined && (
        <Link to={currentHref}>See the current record</Link>
      )}
      <SummaryList
        items={[
          { term: 'Name', value: snapshot.name },
          { term: 'Legal form', value: legalForms[snapshot.legalForm] },
          {
            term: 'Registered address',
            value: [address.line1, address.line2, address.town, address.postcode]
              .filter(Boolean)
              .join(', '),
          },
          { term: 'Website', value: snapshot.website ?? 'Not given' },
          ...snapshot.identifiers.map((identifier) => ({
            term: identifierSchemes[identifier.scheme].label,
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <span className="break-all">{identifier.identifier}</span>
                <Tag tone={identifier.verifiedAt === null ? 'neutral' : 'success'}>
                  {identifier.verifiedAt === null
                    ? 'Not verified'
                    : `Verified ${formatMoment(identifier.verifiedAt, timeZone)}`}
                </Tag>
              </span>
            ),
          })),
          { term: 'Taken', value: formatMoment(snapshot.takenAt, timeZone) },
        ]}
      />
    </Panel>
  );
}
