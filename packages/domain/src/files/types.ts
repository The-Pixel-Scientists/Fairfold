// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file types the platform accepts, and its limits (ADR 0047). No SVG,
// HTML, archives or programs. A type is what sniffFileType() finds in the
// file's bytes, never its name or the type a browser declares.

/** 10 MiB. No tenant or form can raise it; a file question may set a lower limit. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** The most files one file question may take. */
export const MAX_FILES_PER_FIELD = 10;

export const fileTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/jpeg',
  'image/png',
] as const;

export type FileType = (typeof fileTypes)[number];

/** Each type in words, for people. */
export const fileTypeLabels: Readonly<Record<FileType, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.oasis.opendocument.text': 'OpenDocument text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument spreadsheet',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
};

/** Each type's usual extensions, such as for a file picker's `accept`. */
export const fileTypeExtensions: Readonly<Record<FileType, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};
