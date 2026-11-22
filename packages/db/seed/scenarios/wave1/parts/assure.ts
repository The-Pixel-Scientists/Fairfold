// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure: synthetic parties designed against the synthetic list in
// ../sanctions.ts, each with a screening run a due diligence officer asked
// for. The seed cannot load that list: assure.reference_list and
// assure.sanctions_entry are platform tables that only the list loader
// writes (ADR 0031), and their source must be the real UK list's. So every
// run here is in a state that needs no list: the last two are still queued,
// and the rest found no list loaded, as the screening job records it. No
// run has a match or a decision, and nothing here touches an application
// (rule 9).

import { fictionalPostcode } from '../../../synthetic.ts';
import { addOrganisation, addPerson, personEmail, type Part, type PartWriter } from '../write.ts';

/** How each party should meet the list once it is loaded, and the entry it is designed against. */
export const screeningCases = [
  { case: 'exact name', entry: 'SYNTH-I001', person: ['Ellis', 'Dunholt'] },
  { case: 'alias only', entry: 'SYNTH-I002', person: ['Kasia', 'Wrenfield'] },
  { case: 'transposed letters', entry: 'SYNTH-I003', person: ['Rosa', 'Calderiwck'] },
  { case: 'missing middle name', entry: 'SYNTH-I004', person: ['Theo', 'Ivybank'] },
  { case: 'diacritics', entry: 'SYNTH-I005', person: ['Leon', 'Thistledown'] },
  {
    case: 'name matches, date of birth does not',
    entry: 'SYNTH-I006',
    person: ['Adam', 'Hollinbridge'],
  },
  { case: 'Ltd for Limited', entry: 'SYNTH-E001', organisation: 'Ravensholt Trading Ltd' },
  { case: 'common words', entry: 'SYNTH-E002', organisation: 'Willowmere Community Choir' },
] as const satisfies readonly ({ case: string; entry: string } & (
  { person: readonly [string, string] } | { organisation: string }
))[];

/** The runs left queued, from the end of the cases. */
const QUEUED = 2;

async function write(writer: PartWriter): Promise<void> {
  const { client, insert, tenant, tenantId } = writer;
  const officer = writer.member('due_diligence_officer');
  for (const [index, screening] of screeningCases.entries()) {
    const partyId =
      'person' in screening
        ? await addPerson(
            writer,
            screening.person,
            personEmail(tenant, 'screening', screening.person),
          )
        : await addOrganisation(writer, {
            name: screening.organisation,
            legalForm: 'company_limited_by_guarantee',
            addressLine1: `${String(index + 1)} Foundry Lane`,
            town: screening.organisation.split(' ')[0] ?? 'Ravensholt',
            postcode: fictionalPostcode(2_000 + index),
          });
    const runId = await insert('assure.screening_run', {
      tenant_id: tenantId,
      party_id: partyId,
      trigger: 'on_demand',
      requested_by: officer,
    });
    if (index < screeningCases.length - QUEUED) {
      await client.query("UPDATE assure.screening_run SET status = 'no_list' WHERE id = $1", [
        runId,
      ]);
    }
  }
}

export const part: Part = { tool: 'assure', write };
