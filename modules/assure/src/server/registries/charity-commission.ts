// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Charity Commission for England and Wales (ADR 0031): the Register of
// Charities API, one charity per request, with the key in the
// Ocp-Apim-Subscription-Key header. The path, header and field names are
// what ADR 0031 records from general knowledge (GK), which is not yet
// confirmed against the register or a live key, and neither are its rate
// limit or whether one deployment key may serve many funders. Give this
// adapter no key until the ADR is amended with those facts; a change then
// belongs in this file alone.

import { MAX_OFFICERS, type LookupOutcome, type RegistryAdapter } from '../../contracts/index.ts';
import { day, list, parsed, pence, raw, refuse, required, text } from './parse.ts';
import type { Secret } from './secret.ts';
import { finish, isIdentifier, type Transport } from './transport.ts';

const HOST = 'https://api.charitycommission.gov.uk';

const statuses: Readonly<Record<string, 'registered' | 'removed'>> = {
  registered: 'registered',
  removed: 'removed',
};

export const charityUrl = (identifier: string): string =>
  `${HOST}/register/api/allcharitydetailsV2/${encodeURIComponent(identifier)}/0`;

/** The register's entry as the contract's result, or refused. Exported for the tests. */
export function normaliseCharity(body: unknown, identifier: string, at: Date): LookupOutcome {
  return parsed(() => {
    const entry = raw(body);
    const number = entry['reg_charity_number'];
    if (String(number) !== identifier) refuse();
    const lines = [
      'address_line_one',
      'address_line_two',
      'address_line_three',
      'address_line_four',
      'address_line_five',
    ].flatMap((key) => text(entry, key, 200) ?? []);
    const postcode = text(entry, 'address_post_code', 16);
    const [first, ...rest] = lines;
    const town = rest.pop();
    const periodEnd = day(entry, 'latest_acc_fin_period_end_date');
    const money = (key: string) => {
      const amountMinor = pence(entry, key);
      return amountMinor === null ? null : { amountMinor, currency: 'GBP' as const };
    };
    return finish(
      {
        registry: 'charity_commission',
        identifier,
        status:
          statuses[required(entry, 'charity_registration_status', 40).toLowerCase()] ?? 'other',
        registeredName: required(entry, 'charity_name', 300),
        registeredAddress:
          first === undefined || town === undefined || postcode === null
            ? null
            : {
                line1: first,
                line2: rest.length > 0 ? rest.join(', ') : null,
                town,
                postcode,
                countryCode: 'GB',
              },
        registeredOn: day(entry, 'date_of_registration'),
        removedOn: day(entry, 'date_of_removal'),
        accounts:
          periodEnd === null
            ? null
            : {
                periodEnd,
                income: money('latest_income'),
                expenditure: money('latest_expenditure'),
              },
        accountsOverdue: null,
        officers: list(entry, 'trustee_names', MAX_OFFICERS).flatMap((trustee) => {
          const name = text(trustee, 'trustee_name', 200);
          return name === null ? [] : [{ name, role: 'trustee' as const }];
        }),
      },
      at,
    );
  });
}

export function charityCommission(key: Secret, transport: Transport): RegistryAdapter {
  return {
    registry: 'charity_commission',
    async lookUp(identifier) {
      if (!isIdentifier('charity_commission', identifier)) {
        return { ok: false, failure: 'not_found' };
      }
      const fetched = await transport.get(charityUrl(identifier), {
        'Ocp-Apim-Subscription-Key': key.reveal(),
      });
      return fetched.ok
        ? normaliseCharity(fetched.body, identifier, transport.now())
        : { ok: false, failure: fetched.failure };
    },
  };
}
