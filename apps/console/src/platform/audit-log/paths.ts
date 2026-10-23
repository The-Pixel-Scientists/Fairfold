// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log's address, inside the funder's address. The filters travel in
// the search string, so Back, a bookmark and a shared link show the same list.

export const AUDIT_LOG_PATH = '/audit-log';

/** `search` is a string from searchOf(): empty, or starting with "?". */
export const auditLogPath = (search = '') => `${AUDIT_LOG_PATH}${search}`;
