// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the decision pages, inside the funder's address. Both
// belong to a round.

export const decisionsPath = (roundId: string) => `/rounds/${roundId}/decisions`;

export const releasePath = (roundId: string) => `/rounds/${roundId}/decisions/release`;
