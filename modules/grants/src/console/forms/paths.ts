// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of a round's form pages, inside the funder's address.

export const formPath = (roundId: string) => `/rounds/${roundId}/form`;
export const formVersionPath = (roundId: string, formVersionId: string) =>
  `/rounds/${roundId}/form/${formVersionId}`;
