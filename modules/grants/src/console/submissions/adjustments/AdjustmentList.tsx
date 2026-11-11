// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { adjustmentReasons } from '../../../contracts/index.ts';
import type { Adjustment } from '../../../contracts/index.ts';
import { formatMoment } from '../../programme/format.ts';
import { grantedWords, givenWords } from './words.ts';

export interface AdjustmentListProps {
  adjustments: readonly Adjustment[];
  caption: string;
  /** Names each organisation, for a list that holds several. */
  showOrganisation?: boolean;
  /** Without it the list is read only. */
  onRevoke?: (adjustment: Adjustment) => void;
  /** More actions on a row that is still in force. */
  rowActions?: (adjustment: Adjustment) => ReactNode;
  empty: ReactNode;
}

function columns({
  showOrganisation,
  onRevoke,
  rowActions,
}: Pick<
  AdjustmentListProps,
  'showOrganisation' | 'onRevoke' | 'rowActions'
>): Column<Adjustment>[] {
  return [
    {
      key: 'given',
      header: 'Adjustment',
      rowHeader: true,
      cell: (adjustment) => (
        <span className="flex flex-col">
          {showOrganisation && <span className="font-medium">{adjustment.organisation.name}</span>}
          {givenWords(adjustment)}
        </span>
      ),
    },
    { key: 'reason', header: 'Reason', cell: ({ reasonCode }) => adjustmentReasons[reasonCode] },
    { key: 'by', header: 'Given by', cell: grantedWords },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (adjustment) =>
        adjustment.revoked === null ? (
          <span className="flex flex-wrap justify-end gap-2">
            {rowActions?.(adjustment)}
            {onRevoke && (
              <Button
                onClick={() => {
                  onRevoke(adjustment);
                }}
              >
                Remove
                <span className="sr-only">
                  {' '}
                  {givenWords(adjustment)} for {adjustment.organisation.name}
                </span>
              </Button>
            )}
          </span>
        ) : (
          <span className="flex flex-col items-end gap-1">
            <Tag tone="neutral">Removed</Tag>
            <span className="text-sm text-muted">
              {adjustment.revoked.by.name ?? 'A team member'},{' '}
              {formatMoment(adjustment.revoked.at, adjustment.timeZone)}
            </span>
          </span>
        ),
    },
  ];
}

/** Adjustments with what each gives, why, who gave it and when, and a way to remove it. */
export function AdjustmentList({ adjustments, caption, empty, ...options }: AdjustmentListProps) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns(options)}
      rows={adjustments}
      rowKey={(adjustment) => adjustment.id}
      empty={empty}
    />
  );
}
