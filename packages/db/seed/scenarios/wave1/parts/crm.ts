// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm: organisations and people shaped for ADR 0025's duplicate rules, one
// merge already made, two lists and a segment. Candidates share a postcode
// and have similar names; look-alikes have the same name but a different
// postcode, or different verified charity numbers. The merged pair is
// written as the merge writes it: the loser changed to merged into the
// survivor by the programme manager, then its crm.merge_record, with no row
// to re-point and the SHA-256 of the confirmed preview's basis text. Duplicate
// people share a name with different addresses, or share an address: the
// database keeps addresses in lower case, so an address that differed only
// in case is stored the same.

import { createHash } from 'node:crypto';

import { fictionalPostcode, inventedIdentifier } from '../../../synthetic.ts';
import {
  addOrganisation,
  addPerson,
  personEmail,
  type Organisation,
  type Part,
  type PartWriter,
} from '../write.ts';

const organisation = (
  name: string,
  legalForm: string,
  street: string,
  town: string,
  postcode: number,
): Organisation => ({
  name,
  legalForm,
  addressLine1: street,
  town,
  postcode: fictionalPostcode(3_000 + postcode),
});

const CIO = 'charitable_incorporated_organisation';
const CHARITY = 'registered_charity';

/** Pairs ADR 0025's rules should raise: a similar name and the same postcode. */
export const candidatePairs = [
  [
    organisation('Ambleford Food Bank', CIO, '4 Market Place', 'Ambleford', 0),
    organisation('Ambleford Foodbank', CIO, '4 Market Place', 'Ambleford', 0),
  ],
  [
    organisation('Brinkholt Arts Trust', CIO, '12 Chapel Row', 'Brinkholt', 1),
    organisation('The Brinkholt Arts Trust', CIO, 'Unit 3, 12 Chapel Row', 'Brinkholt', 1),
  ],
] as const;

/** Pairs that look alike but must not be merged: another postcode, or another verified number. */
export const lookAlikes = {
  postcode: [
    organisation('Copperfold Repair Cafe', 'unincorporated_group', '8 Mill Lane', 'Copperfold', 2),
    organisation(
      'Copperfold Repair Cafe',
      'unincorporated_group',
      '30 Well Street',
      'Copperfold',
      3,
    ),
  ],
  identifier: [
    organisation('Dunholt Heritage Society', CHARITY, '1 Church Road', 'Dunholt', 4),
    organisation('Dunholt Heritage Society', CHARITY, '1 Church Road', 'Dunholt', 4),
  ],
} as const;

/** The survivor, then the loser already merged into it. */
export const mergedPair = [
  organisation(
    'Elderbrook Community Transport',
    'company_limited_by_guarantee',
    '9 Station Road',
    'Elderbrook',
    5,
  ),
  organisation(
    'Elderbrook Community Transport Ltd',
    'company_limited_by_guarantee',
    '9 Station Road',
    'Elderbrook',
    5,
  ),
] as const;

/** The same person twice under different addresses, and twice under one. */
export const duplicatePeople = [
  { name: ['Nadia', 'Brennan'], labels: ['community', 'volunteers'] },
  { name: ['Kofi', 'Bell'], labels: ['community', 'community'] },
] as const;

/** One filter, under a fixed id: organisations that are registered charities. */
export const charitySegment = {
  '6f1d2c3a-0b4e-4c5d-9e8f-7a6b5c4d3e2f': {
    field: 'legal_form',
    operator: 'eq',
    value: CHARITY,
  },
};

/** The text the confirmed preview's token covered, as previewBasisText() in crm's contracts builds it. */
export const mergeBasisText = (loserId: string, survivorId: string): string =>
  JSON.stringify([loserId, survivorId, 'organisation', [], [], [], 'none', []]);

async function write(writer: PartWriter): Promise<void> {
  const { client, insert, tenant, tenantId } = writer;
  const manager = writer.member('programme_manager');
  const add = (o: Organisation) => addOrganisation(writer, o);

  const candidates = [];
  for (const pair of candidatePairs) candidates.push(await add(pair[0]), await add(pair[1]));
  for (const o of lookAlikes.postcode) await add(o);
  const heritage: string[] = [];
  for (const [n, o] of lookAlikes.identifier.entries()) {
    const id = await add(o);
    heritage.push(id);
    await insert('party.organisation_identifier', {
      tenant_id: tenantId,
      organisation_id: id,
      scheme: 'GB-CHC',
      identifier: inventedIdentifier('GB-CHC', 100 + n),
      verified_at: new Date(),
      verified_by: manager,
    });
  }

  const survivorId = await add(mergedPair[0]);
  const loserId = await add(mergedPair[1]);
  await client.query(
    "UPDATE party.party SET status = 'merged', merged_into = $1, updated_by = $2 WHERE id = $3",
    [survivorId, manager, loserId],
  );
  await insert('crm.merge_record', {
    tenant_id: tenantId,
    kind: 'organisation',
    action: 'merge',
    loser_id: loserId,
    survivor_id: survivorId,
    repointed_counts: {},
    preview_hash: createHash('sha256').update(mergeBasisText(loserId, survivorId)).digest('hex'),
    merged_by: manager,
  });

  for (const { name, labels } of duplicatePeople) {
    for (const label of labels) await addPerson(writer, name, personEmail(tenant, label, name));
  }

  const lists = [
    ['Records to check', 'Organisations that may be recorded twice.', candidates],
    ['Heritage groups', 'Groups that look after local history and buildings.', heritage],
  ] as const;
  for (const [name, description, members] of lists) {
    const listId = await insert('crm.list', {
      tenant_id: tenantId,
      name,
      description,
      created_by: manager,
      updated_by: manager,
    });
    for (const partyId of members) {
      await insert('crm.list_member', {
        tenant_id: tenantId,
        list_id: listId,
        party_id: partyId,
        added_by: manager,
      });
    }
  }
  await insert('crm.segment', {
    tenant_id: tenantId,
    name: 'Registered charities',
    description: 'Organisations registered with a charity regulator.',
    definition: charitySegment,
    created_by: manager,
    updated_by: manager,
  });
}

export const part: Part = { tool: 'crm', write };
