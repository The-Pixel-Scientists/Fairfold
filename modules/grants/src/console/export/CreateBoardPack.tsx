// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Notice, useCan } from '@pixel-scientists/ui';
import { useState } from 'react';

import { MAX_BOARD_PACK_APPLICATIONS } from '../../contracts/index.ts';
import { startJob } from './jobs.ts';
import { useExport } from './useExport.tsx';

export interface CreateBoardPackProps {
  /** The ids of the selected applications. Nothing else is sent: the server chooses the layout. */
  selectedIds: readonly string[];
}

/** Creates a board pack of the selection, for the selection toolbar. Its status shows on a row of its own. */
export function CreateBoardPack({ selectedIds }: CreateBoardPackProps) {
  const allowed = useCan('grants.data.export');
  const { start, starting, panel } = useExport('pack');
  const [over, setOver] = useState(0);
  if (!allowed) return null;

  function create() {
    const extra = selectedIds.length - MAX_BOARD_PACK_APPLICATIONS;
    setOver(Math.max(extra, 0));
    if (extra > 0) return;
    void start((key) => startJob.pack(selectedIds, key));
  }

  return (
    <div className="contents">
      <Button
        disabled={selectedIds.length === 0}
        aria-disabled={starting || undefined}
        onClick={create}
      >
        Create board pack
      </Button>
      <div className="w-full">
        {over > 0 && (
          <div role="alert">
            <Notice tone="warning" title="Too many applications for one board pack">
              A board pack holds up to {MAX_BOARD_PACK_APPLICATIONS}. Deselect {over} and try again.
              Your selection is kept.
            </Notice>
          </div>
        )}
        {panel}
      </div>
    </div>
  );
}
