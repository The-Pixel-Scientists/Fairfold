// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BreakGlassGrant } from '@pixel-scientists/domain/platform/team';
import { DataTable, breakGlassReasonLabels, formatUkTime } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

/** `cases.case` as "Case": the kind of record, never which one. */
const recordKind = (recordType: string): string => {
  const kind = (recordType.split('.').pop() ?? recordType).replaceAll('_', ' ');
  return kind.charAt(0).toUpperCase() + kind.slice(1);
};

const columns: readonly Column<BreakGlassGrant>[] = [
  {
    key: 'kind',
    header: 'Kind of record',
    rowHeader: true,
    cell: (grant) => recordKind(grant.recordType),
  },
  { key: 'reason', header: 'Reason', cell: (grant) => breakGlassReasonLabels[grant.reasonCode] },
  { key: 'opened', header: 'Opened', cell: (grant) => formatUkTime(grant.grantedAt) },
  {
    key: 'expires',
    header: 'Ends',
    cell: (grant) => `${formatUkTime(grant.expiresAt)} UK time`,
  },
];

/** The caller's open grants: what kind of record, why, and when each ends. Never which record. */
export function GrantsTable({ grants }: { grants: readonly BreakGlassGrant[] }) {
  return (
    <DataTable
      caption="Your open emergency access"
      captionHidden
      columns={columns}
      rows={grants}
      rowKey={(grant) => grant.id}
    />
  );
}
