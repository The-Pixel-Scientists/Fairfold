// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the assure pages, inside the funder's address.

export const ASSURE_PATH = '/assure';

export const organisationLookupsPath = (organisationId: string) =>
  `/assure/organisations/${organisationId}`;
export const matchPath = (matchId: string) => `/assure/matches/${matchId}`;
