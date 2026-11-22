// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, useCan } from '@pixel-scientists/ui';

import { startJob } from './jobs.ts';
import { useExport } from './useExport.tsx';

export interface ExportCsvProps {
  /** The open saved view's id, or null when no saved view is open. */
  viewId: string | null;
  /** True when the open view has changes that are not saved. */
  unsaved: boolean;
}

/** Exports the open saved view as CSV. The request holds the view's id only; the server reads the saved view. */
export function ExportCsv({ viewId, unsaved }: ExportCsvProps) {
  const allowed = useCan('grants.data.export');
  const { start, starting, panel } = useExport('csv');
  if (!allowed) return null;

  return (
    <div className="flex flex-col items-start gap-2">
      {viewId === null ? (
        <p className="text-body text-muted">Save the view first, then export it as CSV.</p>
      ) : (
        <>
          <Button
            aria-disabled={starting || undefined}
            onClick={() => {
              void start((key) => startJob.csv(viewId, key));
            }}
          >
            Export as CSV
          </Button>
          {unsaved && (
            <p className="text-body text-muted">
              The export uses the saved version of this view, not the changes you have made.
            </p>
          )}
        </>
      )}
      <div className="w-full">{panel}</div>
    </div>
  );
}
