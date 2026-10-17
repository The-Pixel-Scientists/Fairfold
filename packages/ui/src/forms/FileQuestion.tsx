// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { asProblem } from '../auth/problems.ts';
import { Button } from '../Button.tsx';
import { FileDrop } from '../data/FileDrop.tsx';
import type { FileDropItem } from '../data/FileDrop.tsx';
import { FieldGroup } from '../FieldGroup.tsx';
import { focusElement } from '../focus.ts';
import { FileEntry, fileSize, typesInWords } from './files.tsx';
import type { AttachedFile, FileFieldDefinition, FileHelpers, FormFiles } from './types.ts';

export interface FileQuestionProps {
  field: FileFieldDefinition;
  /** The form's files. Without them the question can only be read, and has none. */
  files?: FormFiles | undefined;
  /** What is wrong with the question, as words: the form's problems, and the files refused. */
  errors: readonly string[];
  /**
   * Called with the words for each file refused in the last choice, by the
   * browser's check or by the server, and with none when a new choice starts.
   */
  onRefused?: ((messages: readonly string[]) => void) | undefined;
  helpers: Partial<FileHelpers>;
}

/** A file on its way: waiting for the ones before it, then sent a percent at a time. */
interface Pending {
  key: number;
  file: File;
  /** Null while it waits; 100 once every byte is sent and the server is checking it. */
  percent: number | null;
}

/** A form with no way to attach files, whose file questions can only be read. */
const NO_FILES: FormFiles = {
  files: [],
  readOnly: true,
  hrefFor: () => '',
  onUpload: () => Promise.resolve(),
  onRemove: () => undefined,
};

/** FileDrop draws the way in; the files are listed here, with a link and a type. */
const NO_ITEMS: readonly FileDropItem[] = [];

const TRY_AGAIN = 'We could not upload this file. Try again.';

const countFiles = (count: number) => `${String(count)} file${count === 1 ? '' : 's'}`;

function pendingWords({ file, percent }: Pending): string {
  if (percent === null) return `Waiting to upload ${file.name}`;
  if (percent === 100) return `Checking ${file.name} for viruses`;
  return `Uploading ${file.name}, ${String(percent)}%`;
}

/** The live region has no children of React's, so each message replaces the last. */
function announce(region: HTMLElement | null, message: string): void {
  if (region !== null) region.textContent = message;
}

/**
 * A file question, answered by attaching files. Each file is checked in the
 * browser by what its bytes are, never by its name, then sent one at a time:
 * the question shows "Uploading", then "Checking for viruses", and the file
 * joins the list when the server has it. A refused file is reported through
 * `onRefused`, and the person can choose another. Each attached file is a link
 * to download it with a button to remove it; removing one moves focus to the
 * file input. At the question's limit the input gives way to words saying so.
 * Each step is announced from a polite live region. The server checks
 * everything again.
 */
export function FileQuestion({
  field,
  files: form = NO_FILES,
  errors,
  onRefused,
  helpers,
}: FileQuestionProps) {
  const attached = form.files.filter(({ fieldId }) => fieldId === field.id);
  const readOnly = form.readOnly === true;
  const full = attached.length >= field.maxFiles;

  const [pending, setPending] = useState<readonly Pending[]>([]);
  const nextKey = useRef(0);
  const region = useRef<HTMLDivElement>(null);
  const limit = useRef<HTMLParagraphElement>(null);
  const removing = useRef<AttachedFile | null>(null);
  const wasFull = useRef(full);

  // A removed file takes its button with it, so focus goes to the file input.
  useEffect(() => {
    const removed = removing.current;
    if (removed === null || attached.some(({ id }) => id === removed.id)) return;
    removing.current = null;
    announce(region.current, `${removed.name} removed`);
    document.getElementById(field.id)?.focus();
  });

  // The last file to join takes the input's place. If focus went with the input, the words take it.
  useEffect(() => {
    if (full && !wasFull.current && document.activeElement === document.body && limit.current) {
      focusElement(limit.current);
    }
    wasFull.current = full;
  }, [full]);

  /** The words for a file the browser can tell the server will refuse, or undefined. */
  async function refusal(file: File): Promise<string | undefined> {
    const { sniffFileType, checkFile } = helpers;
    if (sniffFileType === undefined || checkFile === undefined) return undefined;
    try {
      // A file over the limit is refused without being read.
      const type =
        file.size > field.maxBytes ? null : sniffFileType(new Uint8Array(await file.arrayBuffer()));
      return checkFile(field, { bytes: file.size, type });
    } catch {
      return TRY_AGAIN;
    }
  }

  async function send({ key, file }: Pending): Promise<void> {
    const show = (percent: number) => {
      setPending((current) =>
        current.map((item) => (item.key === key ? { ...item, percent } : item)),
      );
    };
    let checking = false;
    show(0);
    announce(region.current, `Uploading ${file.name}`);
    await form.onUpload(field.id, file, (sent, total) => {
      const percent = total > 0 ? Math.floor((sent / total) * 100) : 100;
      show(percent);
      if (percent === 100 && !checking) {
        checking = true;
        announce(region.current, `Checking ${file.name} for viruses`);
      }
    });
    announce(region.current, `${file.name} added`);
  }

  async function add(chosen: File[]): Promise<void> {
    const room = Math.max(field.maxFiles - attached.length - pending.length, 0);
    const refused = chosen
      .slice(room)
      .map(
        ({ name }) =>
          `${name}: This question takes up to ${countFiles(field.maxFiles)}. Remove a file to attach another.`,
      );
    const queue: Pending[] = [];
    for (const file of chosen.slice(0, room)) {
      const problem = await refusal(file);
      if (problem === undefined) queue.push({ key: nextKey.current++, file, percent: null });
      else refused.push(`${file.name}: ${problem}`);
    }
    onRefused?.([...refused]);
    setPending((current) => [...current, ...queue]);

    // One at a time, so a question never asks the server to scan more than it can.
    for (const item of queue) {
      try {
        await send(item);
      } catch (error) {
        refused.push(`${item.file.name}: ${asProblem(error)?.detail ?? TRY_AGAIN}`);
        onRefused?.([...refused]);
      } finally {
        setPending((current) => current.filter(({ key }) => key !== item.key));
      }
    }
  }

  const label = `${field.label} (${field.required ? 'required' : 'optional'})`;
  const error =
    errors.length === 0
      ? undefined
      : errors.map((message, index) => (
          <span key={`${String(index)}:${message}`} className="block">
            {message}
          </span>
        ));

  const list: ReactNode = (attached.length > 0 || pending.length > 0) && (
    <ul
      role="list"
      aria-label={`Files for ${field.label}`}
      className="divide-y divide-divider border-y border-divider"
    >
      {attached.map((file) => (
        <li key={file.id} className="flex items-center gap-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <FileEntry file={file} href={form.hrefFor(file.id)} labels={helpers.fileTypeLabels} />
          </div>
          {!readOnly && (
            <Button
              variant="quiet"
              onClick={() => {
                removing.current = file;
                form.onRemove(field.id, file.id);
              }}
            >
              Remove <span className="sr-only">{file.name}</span>
            </Button>
          )}
        </li>
      ))}
      {pending.map((item) => {
        const id = `${field.id}-upload-${String(item.key)}`;
        return (
          <li key={item.key} className="flex flex-col gap-1 py-2.5">
            <p id={id} className="text-body break-words text-ink">
              {pendingWords(item)}
            </p>
            {item.percent !== null && item.percent < 100 && (
              <progress
                aria-labelledby={id}
                max={100}
                value={item.percent}
                className="h-1 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-divider [&::-webkit-progress-value]:bg-accent"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
  const status = <div ref={region} role="status" className="sr-only" />;

  if (readOnly) {
    return (
      <FieldGroup legend={label} error={error} id={field.id}>
        {attached.length === 0 && <p className="text-body text-muted">No files attached.</p>}
        {list}
        {status}
      </FieldGroup>
    );
  }

  const accepted =
    `${typesInWords(field.allowedTypes, helpers.fileTypeLabels)}, up to ${fileSize(field.maxBytes, Math.floor)}.` +
    (field.maxFiles > 1 ? ` You can attach up to ${countFiles(field.maxFiles)}.` : '');
  // The list stands in the same place whichever of the two comes first, so a button in it keeps focus.
  return (
    <div className="flex flex-col gap-field-gap">
      {full ? (
        <FieldGroup legend={label} error={error} id={field.id}>
          <p ref={limit} className="text-body text-muted">
            You have reached the limit of {countFiles(field.maxFiles)}. Remove a file to attach
            another.
          </p>
        </FieldGroup>
      ) : (
        <FileDrop
          id={field.id}
          label={label}
          hint={
            <>
              {field.hint !== undefined && <span className="block">{field.hint}</span>}
              <span className="block">{accepted}</span>
            </>
          }
          accept={field.allowedTypes.join(',')}
          multiple={field.maxFiles > 1}
          files={NO_ITEMS}
          error={error}
          onFilesChosen={(chosen) => {
            void add(chosen);
          }}
        />
      )}
      {list}
      {status}
    </div>
  );
}
