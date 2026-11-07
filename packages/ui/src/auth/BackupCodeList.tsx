// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { Button } from '../Button.tsx';
import { focusElement } from '../focus.ts';
import { Notice } from '../layout/Notice.tsx';

export interface BackupCodeListProps {
  /**
   * The codes, shown once. Keep them in component state only, never in a URL,
   * history, storage, a title or a log, and drop them when this unmounts.
   */
  codes: readonly string[];
  /** Called when the person says they have saved the codes. Drop the codes there. */
  onDone: () => void;
}

/** The file's words, with no name of any product or funder in it. */
const fileText = (codes: readonly string[]) =>
  `Backup codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;

/**
 * Backup codes, shown once, with a way to copy them or save them as a text
 * file built in the browser. Focus moves to the list when it appears. The
 * clipboard is written only when "Copy codes" is pressed, and the download's
 * address is revoked as soon as the download has started.
 */
export function BackupCodeList({ codes, onDone }: BackupCodeListProps) {
  const list = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (list.current) focusElement(list.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setMessage('Codes copied.');
    } catch {
      setMessage('The codes could not be copied. Download them, or write them down.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([fileText(codes)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Codes downloaded.');
  }

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning" icon="lock" title="These codes are shown once">
        Copy or download them now. Once you leave this page you cannot see them again. Each code
        works one time, and these codes replace any you had before.
      </Notice>
      <div
        ref={list}
        tabIndex={-1}
        role="group"
        aria-label="Your backup codes"
        className="rounded-md border border-divider bg-sunken p-3"
      >
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-lg text-ink select-all min-[400px]:grid-cols-2">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            void copy();
          }}
        >
          Copy codes
        </Button>
        <Button onClick={download}>Download codes</Button>
        <Button variant="primary" onClick={onDone}>
          I have saved my codes
        </Button>
      </div>
      <p role="status" className="min-h-6 text-body text-muted">
        {message}
      </p>
    </div>
  );
}
