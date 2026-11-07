// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@pixel-scientists/ui';
import { useState } from 'react';

/** A value to copy into another service, with a button that says what it copies and announces "Copied". */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied');
    } catch {
      setMessage('Could not copy. Select the text and copy it.');
    }
  }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <dt className="text-body font-medium text-ink sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-sm bg-sunken px-2 py-1 text-sm break-all text-ink">
          {value}
        </code>
        <Button
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void copy();
          }}
        >
          Copy
        </Button>
        <span role="status" className="text-body font-medium text-success">
          {message}
        </span>
      </dd>
    </div>
  );
}
