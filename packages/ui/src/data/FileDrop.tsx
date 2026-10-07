// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';

import { buttonClassName } from '../Button.tsx';
import { cx } from '../cx.ts';
import { FieldGroup } from '../FieldGroup.tsx';

export type FileStatus = 'uploading' | 'scanning' | 'ready' | 'failed';

export interface FileDropItem {
  /** Stable for the file, from the moment it is chosen until it is removed. */
  id: string;
  name: string;
  /** In bytes. */
  size: number;
  status: FileStatus;
  /** Percent uploaded, from 0 to 100, while the status is `uploading`. */
  progress?: number;
  /** Why the upload failed and what to do, when the status is `failed`. */
  error?: string;
}

export interface FileDropProps {
  /** What the files are, such as "Supporting documents". Names the group. */
  label: string;
  /** Help before the person chooses, such as which types and sizes are allowed. */
  hint?: ReactNode;
  /**
   * File types the picker offers, as in the HTML `accept` attribute. Dropped
   * files are not filtered by it, so check them in `onFilesChosen`.
   */
  accept?: string;
  /** Lets the person choose or drop more than one file at a time. */
  multiple?: boolean;
  /** Every file added so far. The component shows them and keeps no state of its own. */
  files: readonly FileDropItem[];
  /** Called with the files the person chose or dropped. Start the upload here. */
  onFilesChosen?: (files: File[]) => void;
  /** Called with the id of the file whose "Remove" button was pressed. */
  onRemove?: (id: string) => void;
  /** What went wrong with the files as a whole, and how to fix it. */
  error?: ReactNode;
  /** The id of the file input, so an ErrorSummary can link to it. Generated when left out. */
  id?: string;
}

const units = ['B', 'KB', 'MB', 'GB'] as const;

/** "834 KB", "1.2 MB" or "12 MB". */
function fileSize(bytes: number): string {
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: digits })} ${units[unit] ?? 'B'}`;
}

function statusWords({ status, progress, error }: FileDropItem): string {
  switch (status) {
    case 'uploading':
      return progress === undefined ? 'Uploading' : `Uploading ${String(Math.round(progress))}%`;
    case 'scanning':
      return 'Checking for viruses';
    case 'ready':
      return 'Ready';
    case 'failed':
      return error === undefined ? 'Upload failed' : `Upload failed: ${error}`;
  }
}

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 16 16',
  className: 'size-4 shrink-0',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Status({ file }: { file: FileDropItem }) {
  const words = statusWords(file);
  if (file.status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-success">
        <svg {...iconProps}>
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
        {words}
      </span>
    );
  }
  if (file.status === 'failed') {
    return (
      <span className="inline-flex items-start gap-1 font-medium text-danger">
        <svg {...iconProps}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.5M8 10.75v.01" />
        </svg>
        {words}
      </span>
    );
  }
  return <span>{words}</span>;
}

/**
 * Chooses files and lists them with how each upload is going. "Choose files"
 * is a label for a native file input that is hidden from sight but not from
 * the keyboard or a screen reader, so Tab, Space and Enter work as they do on
 * any file input. Dropping files on the box is an extra, so its prompt is
 * left out on touch screens. When it takes one file and one is attached, the
 * button reads "Replace file" and the prompt goes. Each change of
 * status, and each removal, is announced politely from one live region that
 * is always on the page. This component only shows the state it is given and
 * calls back; it uploads nothing.
 */
export function FileDrop({
  label,
  hint,
  accept,
  multiple = false,
  files,
  onFilesChosen,
  onRemove,
  error,
  id,
}: FileDropProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const refocus = useRef<{ index: number; count: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const replacing = !multiple && files.length > 0;

  // Announce what changed since the files last changed: new statuses and removals.
  const [seen, setSeen] = useState(files);
  const [announcement, setAnnouncement] = useState('');
  if (seen !== files) {
    setSeen(files);
    const changes = [
      ...files
        .filter((file) => seen.find(({ id: seenId }) => seenId === file.id)?.status !== file.status)
        .map((file) => `${file.name}: ${statusWords(file)}`),
      ...seen
        .filter((file) => !files.some(({ id: nowId }) => nowId === file.id))
        .map((file) => `${file.name} removed`),
    ];
    if (changes.length > 0) setAnnouncement(changes.join('. '));
  }

  // A removed file takes its button with it. Move focus to the next one, or to the file input.
  useEffect(() => {
    const removed = refocus.current;
    if (removed === null || files.length >= removed.count) return;
    refocus.current = null;
    const buttons = list.current?.querySelectorAll('button');
    (buttons?.[Math.min(removed.index, buttons.length - 1)] ?? input.current)?.focus();
  }, [files]);

  function choose(chosen: File[]) {
    if (chosen.length > 0) onFilesChosen?.(multiple ? chosen : chosen.slice(0, 1));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    choose(Array.from(event.target.files ?? []));
    // Choosing the same file again must still count as a change.
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    choose(Array.from(event.dataTransfer.files));
  }

  return (
    <FieldGroup legend={label} hint={hint} error={error} id={inputId}>
      {/* Dropping is a pointer extra: the button and the file input are the way in for everyone. */}
      <div
        role="presentation"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
        className={cx(
          'relative flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg border border-dashed px-4 py-6 text-center',
          'transition-colors duration-(--motion-fast) ease-standard',
          dragging ? 'border-accent bg-accent-soft' : 'border-edge/70',
        )}
      >
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          aria-invalid={error ? true : undefined}
          onChange={handleChange}
          className="peer sr-only"
        />
        <label
          htmlFor={inputId}
          className={buttonClassName(
            'secondary',
            'cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          )}
        >
          {multiple ? 'Choose files' : replacing ? 'Replace file' : 'Choose file'}
        </label>
        {!replacing && (
          <span className="text-body text-muted pointer-coarse:hidden">
            {dragging ? 'Drop to add' : `or drop ${multiple ? 'files' : 'a file'} here`}
          </span>
        )}
      </div>
      {files.length > 0 && (
        <ul role="list" ref={list} className="divide-y divide-divider border-y border-divider">
          {files.map((file, index) => (
            <li key={file.id} className="flex items-center gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="font-medium break-words text-ink">{file.name}</p>
                <p className="flex flex-wrap gap-x-2 text-sm text-muted">
                  <span>{fileSize(file.size)}</span>
                  <span aria-hidden="true">·</span>
                  <Status file={file} />
                </p>
                {file.status === 'uploading' && file.progress !== undefined && (
                  <progress
                    aria-hidden="true"
                    max={100}
                    value={file.progress}
                    className="mt-1 h-1 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-divider [&::-webkit-progress-value]:bg-accent"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  refocus.current = { index, count: files.length };
                  onRemove?.(file.id);
                }}
                className={buttonClassName('quiet')}
              >
                Remove <span className="sr-only">{file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </FieldGroup>
  );
}
