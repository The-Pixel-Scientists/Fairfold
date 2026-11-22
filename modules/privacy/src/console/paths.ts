// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy screens' addresses. The console opens a tool at one path, so
// the screens inside it are named in the search string: `?view=breach&id=...`.
// A person or record is named by its id, never by a name.

import { apiBasePath } from '@pixel-scientists/domain/api';

export const PRIVACY_PATH = '/privacy';

export const views = [
  'requests',
  'request',
  'breaches',
  'breach',
  'dpias',
  'dpia',
  'processing',
  'consent',
] as const;

export type View = (typeof views)[number];

export const viewPath = (view: View, id?: string): string =>
  `${PRIVACY_PATH}?view=${view}${id === undefined ? '' : `&id=${id}`}`;

/** The file download route: a plain link, so the server's headers and audit apply. */
export const downloadPath = (fileId: string): string => `${apiBasePath}/console/files/${fileId}`;
