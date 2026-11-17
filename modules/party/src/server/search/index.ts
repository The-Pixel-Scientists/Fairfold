// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Party's search providers for the console's search across tools (ADR 0025).
// Organisations match on name and identifier, people on name and email. A
// name matches as a substring or by trigram similarity (`ext.similarity()`,
// schema-qualified), an email as a substring and an identifier exactly after
// the schemes' normalisation. Row-level security keeps every match in the
// caller's tenant and applies before the similarity test, which is not
// leakproof. Terms and the threshold are parameters; nothing is set for the
// session. Merged and erased parties are never found. A hit is an id and a
// label: the server audits person results, never the provider.

import {
  defineSearchProvider,
  searchableFields,
  type SearchFunction,
  type SearchHit,
  type SearchRequest,
} from '@pixel-scientists/domain/platform/search';

import { identifierSchemeIds, normaliseIdentifier } from '../../contracts/index.ts';
import { partyDb, type PartyDb, type Tx } from '../tables.ts';

/** pg_trgm's own default for its `%` operator: how alike a name must be to count. */
const NAME_SIMILARITY = 0.3;

const staff = ['staff'] as const;

export const organisationSearch = defineSearchProvider({
  module: 'party',
  kind: 'party.organisation',
  permission: 'party.records.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [
    { id: 'name', sensitivity: 'internal', audiences: staff },
    { id: 'identifier', sensitivity: 'internal', audiences: staff },
  ],
  label: 'internal',
});

export const personSearch = defineSearchProvider({
  module: 'party',
  kind: 'party.person',
  permission: 'party.records.read',
  scopes: ['tenant'],
  audiences: staff,
  fields: [
    { id: 'given_name', sensitivity: 'personal', audiences: staff },
    { id: 'family_name', sensitivity: 'personal', audiences: staff },
    { id: 'email', sensitivity: 'personal', audiences: staff },
  ],
  label: 'personal',
  readAction: 'party.person.viewed',
});

/** The longest label the response contract allows. */
const LABEL_MAX = 200;

/** A label cut to the contract's limit, ending in an ellipsis and never half a character. */
function clipLabel(label: string): string {
  if (label.length <= LABEL_MAX) return label;
  const cut = label.slice(0, LABEL_MAX - 1);
  const last = cut.charCodeAt(cut.length - 1);
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

const NOT_GONE = ['merged', 'erased'] as const;

async function findOrganisations(db: PartyDb, { term, audience, limit }: SearchRequest) {
  const fields = searchableFields(organisationSearch, audience);
  if (fields.length === 0) return [];
  const identifiers = [
    ...new Set(identifierSchemeIds.map((scheme) => normaliseIdentifier(scheme, term))),
  ];
  return db
    .selectFrom('party.organisation as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select(['o.id', 'o.name'])
    .where('p.status', 'not in', NOT_GONE)
    .where((eb) =>
      eb.or([
        ...(fields.includes('name')
          ? [
              eb(
                eb.fn<number>('strpos', [
                  eb.fn<string>('lower', [eb.ref('o.name')]),
                  eb.fn<string>('lower', [eb.val(term)]),
                ]),
                '>',
                0,
              ),
              eb(
                eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(term)]),
                '>=',
                NAME_SIMILARITY,
              ),
            ]
          : []),
        ...(fields.includes('identifier')
          ? [
              eb.exists(
                eb
                  .selectFrom('party.organisation_identifier as i')
                  .select('i.id')
                  .whereRef('i.organisation_id', '=', 'o.id')
                  .where('i.identifier', 'in', identifiers),
              ),
            ]
          : []),
      ]),
    )
    .orderBy((eb) => eb.fn<number>('ext.similarity', [eb.ref('o.name'), eb.val(term)]), 'desc')
    .orderBy('o.name')
    .orderBy('o.id')
    .limit(limit)
    .execute();
}

async function findPeople(db: PartyDb, { term, audience, limit }: SearchRequest) {
  const fields = searchableFields(personSearch, audience);
  if (fields.length === 0) return [];
  const names = fields.includes('given_name') || fields.includes('family_name');
  return db
    .selectFrom('party.person as o')
    .innerJoin('party.party as p', 'p.id', 'o.id')
    .select(['o.id', 'o.given_name', 'o.family_name', 'o.email'])
    .where('p.status', 'not in', NOT_GONE)
    .where((eb) => {
      const name = eb.fn<string>('concat_ws', [
        eb.val(' '),
        eb.ref('o.given_name'),
        eb.ref('o.family_name'),
      ]);
      return eb.or([
        ...(names
          ? [
              eb(
                eb.fn<number>('strpos', [
                  eb.fn<string>('lower', [name]),
                  eb.fn<string>('lower', [eb.val(term)]),
                ]),
                '>',
                0,
              ),
              eb(eb.fn<number>('ext.similarity', [name, eb.val(term)]), '>=', NAME_SIMILARITY),
            ]
          : []),
        ...(fields.includes('email')
          ? [
              eb(
                eb.fn<number>('strpos', [
                  eb.fn<string>('lower', [eb.ref('o.email')]),
                  eb.fn<string>('lower', [eb.val(term)]),
                ]),
                '>',
                0,
              ),
            ]
          : []),
      ]);
    })
    .orderBy(
      (eb) =>
        eb.fn<number>('ext.similarity', [
          eb.fn<string>('concat_ws', [
            eb.val(' '),
            eb.ref('o.given_name'),
            eb.ref('o.family_name'),
          ]),
          eb.val(term),
        ]),
      'desc',
    )
    .orderBy('o.family_name')
    .orderBy('o.id')
    .limit(limit)
    .execute();
}

const organisations =
  (tx: Tx): SearchFunction<typeof organisationSearch> =>
  async (request) =>
    (await findOrganisations(partyDb(tx), request)).map((row): SearchHit<'party.organisation'> => ({
      kind: 'party.organisation',
      id: row.id,
      label: clipLabel(row.name),
      module: 'party',
    }));

const people =
  (tx: Tx): SearchFunction<typeof personSearch> =>
  async (request) =>
    (await findPeople(partyDb(tx), request)).map((row): SearchHit<'party.person'> => ({
      kind: 'party.person',
      id: row.id,
      label: clipLabel([row.given_name, row.family_name].filter(Boolean).join(' ') || row.email),
      module: 'party',
    }));

/** Each provider with the search that runs it in the request's transaction. */
export const partySearch = [
  { provider: organisationSearch, search: organisations },
  { provider: personSearch, search: people },
] as const;
