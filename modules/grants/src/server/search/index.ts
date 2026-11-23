// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grants' search provider for the console's search across tools (ADR 0025).
// Staff find a submission by the organisation that made it: the term goes to
// party's organisation search, which matches a name or an identifier, and the
// submissions of the organisations it finds come back newest first under the
// best match. Drafts are never found. Row-level security keeps every match in
// the caller's tenant. A hit is an id and a label built from the
// organisation's name and the round's title.

import {
  defineSearchProvider,
  searchableFields,
  type SearchFunction,
  type SearchHit,
  type SearchRequest,
} from '@pixel-scientists/domain/platform/search';
import { partySearch } from '@pixel-scientists/party/server';

import { submissionStatuses } from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import { submissionsDb } from '../submissions/tables.ts';

const staff = ['staff'] as const;

export const applicationSearch = defineSearchProvider({
  module: 'grants',
  kind: 'grants.application',
  permission: 'grants.applications.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [
    { id: 'organisation_name', sensitivity: 'internal', audiences: staff },
    { id: 'organisation_identifier', sensitivity: 'internal', audiences: staff },
  ],
  label: 'internal',
});

/** The longest label the response contract allows. */
const LABEL_MAX = 200;

const STATUSES = Object.keys(submissionStatuses) as [
  keyof typeof submissionStatuses,
  ...(keyof typeof submissionStatuses)[],
];

const organisations = partySearch.find(
  ({ provider }) => provider.kind === 'party.organisation',
)?.search;

/** The organisation and the round, cut to the contract's limit and never half a character. */
function label(organisation: string, round: string): string {
  const full = `${organisation}, ${round}`;
  if (full.length <= LABEL_MAX) return full;
  const cut = full.slice(0, LABEL_MAX - 1);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

async function findApplications(tx: Tx, request: SearchRequest) {
  if (organisations === undefined) return [];
  if (searchableFields(applicationSearch, request.audience).length === 0) return [];
  const found = await organisations(tx)(request);
  if (found.length === 0) return [];
  const rank = new Map(found.map((hit, index) => [hit.id, { index, name: hit.label }]));
  const rows = await submissionsDb(tx)
    .selectFrom('grants.application as a')
    .innerJoin('grants.round as r', 'r.id', 'a.round_id')
    .select(['a.id', 'a.organisation_id', 'r.title'])
    .where('a.status', 'in', STATUSES)
    .where('a.organisation_id', 'in', [...rank.keys()])
    .orderBy('a.submitted_at', 'desc')
    .orderBy('a.id')
    .limit(request.limit)
    .execute();
  const at = (organisationId: string) => rank.get(organisationId)?.index ?? found.length;
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => at(a.row.organisation_id) - at(b.row.organisation_id) || a.order - b.order)
    .map(({ row }) => ({
      id: row.id,
      label: label(rank.get(row.organisation_id)?.name ?? '', row.title),
    }));
}

const applications =
  (tx: Tx): SearchFunction<typeof applicationSearch> =>
  async (request) =>
    (await findApplications(tx, request)).map((row): SearchHit<'grants.application'> => ({
      kind: 'grants.application',
      id: row.id,
      label: row.label,
      module: 'grants',
    }));

/** Each provider with the search that runs it in the request's transaction. */
export const grantsSearch = [{ provider: applicationSearch, search: applications }] as const;
