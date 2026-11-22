// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Companies House (ADR 0031): the Public Data API, a company's profile and
// its officers, with the key as the HTTP Basic user name and no password.
// The paths, authentication and field names are what ADR 0031 records from
// general knowledge (GK), which is not yet confirmed against the service or a
// live key, and neither are its rate limit or whether one deployment key may
// serve many funders. Give this adapter no key until the ADR is amended with
// those facts; a change then belongs in this file alone. Only current
// officers are kept, by name and role.

import type {
  LookupFailure,
  LookupOutcome,
  RegistryAdapter,
  RegistryResult,
} from '../../contracts/index.ts';
import { count, day, flag, list, parsed, raw, refuse, required, text } from './parse.ts';
import type { Secret } from './secret.ts';
import { finish, isIdentifier, type Transport } from './transport.ts';

const HOST = 'https://api.company-information.service.gov.uk';
const PAGE = 100;
/** Pages of officers read before the list is refused as too long to be complete. */
const MAX_PAGES = 3;

type Role = RegistryResult['officers'][number]['role'];
export interface CurrentOfficer {
  readonly name: string;
  readonly role: Role;
}

const statuses: Readonly<Record<string, RegistryResult['status']>> = {
  active: 'active',
  dissolved: 'dissolved',
  liquidation: 'in_liquidation',
};

const roleOf = (officerRole: string): Role =>
  officerRole.endsWith('director')
    ? 'director'
    : officerRole.endsWith('secretary')
      ? 'secretary'
      : 'other';

const base = (identifier: string): string => `${HOST}/company/${encodeURIComponent(identifier)}`;
export const profileUrl = base;
export const officersUrl = (identifier: string, startIndex: number): string =>
  `${base(identifier)}/officers?items_per_page=${PAGE}&start_index=${startIndex}`;

/** The current officers on one page of the list, and the total the register counts (resigned ones too). */
export function readOfficers(body: unknown): { current: CurrentOfficer[]; total: number } {
  const page = raw(body);
  return {
    total: count(page, 'total_results'),
    current: list(page, 'items', PAGE).flatMap((item) => {
      const name = text(item, 'name', 200);
      const role = required(item, 'officer_role', 60);
      return name === null || day(item, 'resigned_on') !== null
        ? []
        : [{ name, role: roleOf(role) }];
    }),
  };
}

/** The profile and current officers as the contract's result, or refused. Exported for the tests. */
export function normaliseCompany(
  body: unknown,
  officers: readonly CurrentOfficer[],
  identifier: string,
  at: Date,
): LookupOutcome {
  return parsed(() => {
    const profile = raw(body);
    if (required(profile, 'company_number', 8) !== identifier) refuse();
    const office =
      profile['registered_office_address'] === undefined
        ? {}
        : raw(profile['registered_office_address']);
    const line1 = text(office, 'address_line_1', 200) ?? text(office, 'premises', 200);
    const town = text(office, 'locality', 100);
    const postcode = text(office, 'postal_code', 16);
    const accounts = profile['accounts'] === undefined ? {} : raw(profile['accounts']);
    const last = accounts['last_accounts'] === undefined ? {} : raw(accounts['last_accounts']);
    const periodEnd = day(last, 'made_up_to');
    return finish(
      {
        registry: 'companies_house',
        identifier,
        status: statuses[required(profile, 'company_status', 40).toLowerCase()] ?? 'other',
        registeredName: required(profile, 'company_name', 300),
        registeredAddress:
          line1 === null || town === null || postcode === null
            ? null
            : {
                line1,
                line2: text(office, 'address_line_2', 200),
                town,
                postcode,
                countryCode: 'GB',
              },
        registeredOn: day(profile, 'date_of_creation'),
        removedOn: day(profile, 'date_of_cessation'),
        accounts: periodEnd === null ? null : { periodEnd, income: null, expenditure: null },
        accountsOverdue: flag(accounts, 'overdue'),
        officers: [...officers],
      },
      at,
    );
  });
}

export function companiesHouse(key: Secret, transport: Transport): RegistryAdapter {
  const headers = () => ({
    Authorization: `Basic ${Buffer.from(`${key.reveal()}:`).toString('base64')}`,
  });

  /** Every current officer, or why they could not all be read. */
  async function currentOfficers(
    identifier: string,
  ): Promise<readonly CurrentOfficer[] | { readonly failure: LookupFailure }> {
    const current: CurrentOfficer[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const fetched = await transport.get(officersUrl(identifier, page * PAGE), headers());
      if (!fetched.ok) {
        return fetched.failure === 'not_found' ? current : { failure: fetched.failure };
      }
      try {
        const read = readOfficers(fetched.body);
        current.push(...read.current);
        if ((page + 1) * PAGE >= read.total) return current;
      } catch {
        return { failure: 'response_refused' };
      }
    }
    return { failure: 'response_refused' };
  }

  return {
    registry: 'companies_house',
    async lookUp(identifier) {
      if (!isIdentifier('companies_house', identifier)) return { ok: false, failure: 'not_found' };
      const fetched = await transport.get(profileUrl(identifier), headers());
      if (!fetched.ok) return { ok: false, failure: fetched.failure };
      const officers = await currentOfficers(identifier);
      return 'failure' in officers
        ? { ok: false, failure: officers.failure }
        : normaliseCompany(fetched.body, officers, identifier, transport.now());
    },
  };
}
