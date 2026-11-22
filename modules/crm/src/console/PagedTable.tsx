// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, EmptyState, LoadingState } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import type { Paged } from './paged.ts';

export interface PagedTableProps<T> {
  paged: Paged<T>;
  /** Says what is loading, such as "Loading lists". */
  label: string;
  caption: string;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** What to show with no rows: say what to do next. */
  empty: ReactNode;
}

/** A paged list as a table, with its loading, failed and empty states and "Show more". */
export function PagedTable<T>({
  paged,
  label,
  caption,
  columns,
  rowKey,
  empty,
}: PagedTableProps<T>) {
  if (paged.status === 'loading')
    return <LoadingState label={label} className="rounded-lg bg-surface" />;
  if (paged.status === 'failed') {
    return (
      <EmptyState
        title="We could not load this list"
        action={<Button onClick={paged.retry}>Try again</Button>}
      >
        <p>{paged.message}</p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm text-muted">
        {`${String(paged.items.length)}${paged.hasMore ? ' or more' : ''} shown`}
      </p>
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={paged.items}
        rowKey={rowKey}
        empty={empty}
      />
      {paged.moreProblem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {paged.moreProblem}
        </p>
      )}
      {paged.hasMore && (
        <div>
          <Button onClick={paged.more} aria-disabled={paged.loadingMore || undefined}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
