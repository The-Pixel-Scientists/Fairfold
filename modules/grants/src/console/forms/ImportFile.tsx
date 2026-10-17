// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';
import { useId, useRef } from 'react';

/** Chooses a form file. The browser's own file chooser opens from a button, so it looks and works like the others. */
export function ImportFile({
  replaces,
  onFile,
}: {
  /** Says that the file takes the place of what is in the draft. */
  replaces: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        id="import-file"
        variant="quiet"
        aria-describedby={replaces ? hintId : undefined}
        onClick={() => input.current?.click()}
      >
        Import from file
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Form file to import"
        hidden
        onChange={(event) => {
          const [file] = event.currentTarget.files ?? [];
          // Clearing the box lets the same file be chosen again after a fix.
          event.currentTarget.value = '';
          if (file !== undefined) onFile(file);
        }}
      />
      {replaces && (
        <p id={hintId} className="text-sm text-muted">
          Replaces everything in this draft.
        </p>
      )}
    </div>
  );
}
