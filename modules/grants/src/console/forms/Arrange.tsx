// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';
import { useId } from 'react';

/**
 * Buttons to move a section or question up or down its list, and to remove
 * it. A button that cannot act is `aria-disabled`, so focus stays where it
 * was, and the last one says why it stays.
 */
export function Arrange({
  name,
  position,
  count,
  keepsOne,
  onMove,
  onRemove,
}: {
  /** What the buttons act on, for a screen reader: "Organisation name". */
  name: string;
  /** From 0. */
  position: number;
  count: number;
  /** Says why the last one cannot be removed: "A section keeps at least one question." */
  keepsOne: string;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const hintId = useId();
  const last = count === 1;
  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="quiet"
          aria-disabled={position === 0 || undefined}
          onClick={() => {
            if (position > 0) onMove(-1);
          }}
        >
          Move up<span className="sr-only"> {name}</span>
        </Button>
        <Button
          variant="quiet"
          aria-disabled={position === count - 1 || undefined}
          onClick={() => {
            if (position < count - 1) onMove(1);
          }}
        >
          Move down<span className="sr-only"> {name}</span>
        </Button>
        <Button
          variant="quiet"
          aria-disabled={last || undefined}
          aria-describedby={last ? hintId : undefined}
          onClick={() => {
            if (!last) onRemove();
          }}
        >
          Remove<span className="sr-only"> {name}</span>
        </Button>
      </div>
      {last && (
        <p id={hintId} className="text-sm text-muted">
          {keepsOne}
        </p>
      )}
    </div>
  );
}
