// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The subject access and erasure screens' addresses, inside the funder's
// address. A person is named by their id and a request by its id, never by a
// name, email address or search term.

import { apiBasePath } from '@pixel-scientists/domain/api';

export const SUBJECT_ACCESS_PATH = '/settings/subject-access';

export const personPath = (partyId: string) => `${SUBJECT_ACCESS_PATH}/people/${partyId}`;
export const erasurePath = (partyId: string) => `${personPath(partyId)}/erasure`;
export const exportPath = (requestId: string) => `${SUBJECT_ACCESS_PATH}/exports/${requestId}`;
export const erasureStatusPath = (requestId: string) =>
  `${SUBJECT_ACCESS_PATH}/erasures/${requestId}`;

/** The file download route: a plain link, so the server's headers and audit apply. */
export const downloadPath = (fileId: string) => `${apiBasePath}/console/files/${fileId}`;
