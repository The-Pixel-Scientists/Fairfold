// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a file is described to a person: its size and type in words, and its
// name as a link to download it. File names are shown as text and never put in
// an address.

import type { AnswerHelpers, AttachedFile } from './types.ts';

type Labels = AnswerHelpers['fileTypeLabels'];

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const typeList = new Intl.ListFormat('en-GB', { type: 'disjunction' });

/**
 * "834 KB", "1.2 MB" or "12 MB". Rounds to the nearest by default. Say a limit
 * with `Math.floor`, so the words never promise more than the server takes.
 */
export function fileSize(bytes: number, round: (value: number) => number = Math.round): string {
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const scale = unit > 0 && value < 10 ? 10 : 1;
  return `${(round(value * scale) / scale).toLocaleString('en-GB')} ${UNITS[unit] ?? 'B'}`;
}

/** File types in words: "PDF or Word document". A type with no label shows as itself. */
export function typesInWords(types: readonly string[], labels: Labels): string {
  return typeList.format(types.map((type) => labels?.[type] ?? type));
}

export interface FileEntryProps {
  file: AttachedFile;
  /** Where the file downloads from. Without it the name is plain text. */
  href?: string | undefined;
  labels: Labels;
}

/**
 * A file's name, then its type and size. With `href` the name is a link whose
 * name for assistive technology holds all three and says it downloads, so the
 * visible type and size, which repeat them, are hidden from it.
 */
export function FileEntry({ file, href, labels }: FileEntryProps) {
  const details = `${labels?.[file.type] ?? file.type}, ${fileSize(file.bytes)}`;
  return (
    <>
      <span className="min-w-0 font-medium break-words text-ink">
        {href === undefined ? (
          file.name
        ) : (
          <a href={href} aria-label={`Download ${file.name}, ${details}`}>
            {file.name}
          </a>
        )}
      </span>
      <span aria-hidden={href === undefined ? undefined : true} className="text-sm text-muted">
        {details}
      </span>
    </>
  );
}

export interface AnswerFilesProps {
  files: readonly AttachedFile[];
  hrefFor?: ((id: string) => string) | undefined;
  labels: Labels;
}

/** A file question's files as an answer: each a link when there is a way to download it, otherwise a name. */
export function AnswerFiles({ files, hrefFor, labels }: AnswerFilesProps) {
  return (
    <ul role="list" className="flex flex-col gap-1">
      {files.map((file) => (
        <li key={file.id} className="flex flex-wrap items-baseline gap-x-2">
          <FileEntry file={file} href={hrefFor?.(file.id)} labels={labels} />
        </li>
      ))}
    </ul>
  );
}
