// SPDX-License-Identifier: AGPL-3.0-or-later

export const APPROVALS_PATH = '/approvals';

export const approvalPath = (requestId: string): string => `${APPROVALS_PATH}/${requestId}`;
