// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The registry adapters (ADR 0031) against responses written by hand to the
// documented shape: invented numbers and names only, and no call to a live
// register. They need no database.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { registryResultSchema, type LookupOutcome } from '../../contracts/index.ts';
import { createRegistryAdapters, type RegistryKeys } from './adapters.ts';
import { MAX_BODY_BYTES } from './http.ts';
import { Secret } from './secret.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const KEY = 'KEY-sentinel-7f3a9c'; // gitleaks:allow
const keys: RegistryKeys = { charityCommission: new Secret(KEY), companiesHouse: new Secret(KEY) };
const NOW = new Date('2026-11-18T10:00:00.000Z');

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** Adapters whose fetch answers from `answer`, recording each call. */
function adaptersWith(answer: (url: string, call: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const adapters = createRegistryAdapters(keys, {
    now: () => NOW,
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(answer(url, calls.length));
    },
  });
  return { adapters, calls };
}

const CHARITY = '1999001';
const COMPANY = 'ZZ999001';

function companyAnswers(overrides: Partial<Record<'profile' | 'officers', Response>> = {}) {
  return (url: string): Response =>
    url.includes('/officers')
      ? (overrides.officers ?? json(fixture('companies-house-officers')))
      : (overrides.profile ?? json(fixture('companies-house-profile')));
}

describe('Charity Commission', () => {
  it('maps the register entry to the contract result and drops what it does not use', async () => {
    const { adapters, calls } = adaptersWith(() => json(fixture('charity-commission')));
    const outcome = await adapters.charity_commission?.lookUp(CHARITY);
    expect(outcome).toEqual({
      ok: true,
      result: {
        registry: 'charity_commission',
        identifier: CHARITY,
        fetchedAt: NOW.toISOString(),
        status: 'registered',
        registeredName: 'Invented Community Trust',
        registeredAddress: {
          line1: '1 Invented Street',
          line2: 'Exampleside',
          town: 'Testtown',
          postcode: 'ZZ1 1ZZ',
          countryCode: 'GB',
        },
        registeredOn: '1999-04-02',
        removedOn: null,
        accounts: {
          periodEnd: '2025-03-31',
          income: { amountMinor: 12_500_000, currency: 'GBP' },
          expenditure: { amountMinor: 11_850_000, currency: 'GBP' },
        },
        accountsOverdue: null,
        officers: [
          { name: 'Invented Trustee One', role: 'trustee' },
          { name: 'Invented Trustee Two', role: 'trustee' },
        ],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('nobody@example.test');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.charitycommission.gov.uk/register/api/allcharitydetailsV2/${CHARITY}/0`,
    );
  });

  it('shows a removed charity as data, nothing more', async () => {
    const removed = {
      ...(fixture('charity-commission') as object),
      charity_registration_status: 'Removed',
      date_of_removal: '2024-02-01T00:00:00',
    };
    const outcome = await adaptersWith(() => json(removed)).adapters.charity_commission?.lookUp(
      CHARITY,
    );
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: 'removed', removedOn: '2024-02-01' },
    });
  });

  it.each([
    ['a different charity number', { reg_charity_number: 1999002 }],
    ['a fractional income', { latest_income: 10.5 }],
    ['a negative expenditure', { latest_expenditure: -1 }],
    ['a name with a control character', { charity_name: 'Bad\u0000Name' }],
    ['a name with a hidden direction mark', { charity_name: 'Bad\u202eName' }],
    ['a date that is not one', { date_of_registration: 'last year' }],
    ['a name over the limit', { charity_name: 'x'.repeat(301) }],
    [
      'more trustees than the cap',
      { trustee_names: Array.from({ length: 201 }, () => ({ trustee_name: 'Invented Person' })) },
    ],
  ])('refuses the whole response for %s', async (_, change) => {
    const body = { ...(fixture('charity-commission') as object), ...change };
    const outcome = await adaptersWith(() => json(body)).adapters.charity_commission?.lookUp(
      CHARITY,
    );
    expect(outcome).toEqual({ ok: false, failure: 'response_refused' });
  });

  it('answers not found without calling for a value that is not a charity number', async () => {
    const { adapters, calls } = adaptersWith(() => json({}));
    expect(await adapters.charity_commission?.lookUp('../../etc')).toEqual({
      ok: false,
      failure: 'not_found',
    });
    expect(calls).toEqual([]);
  });
});

describe('Companies House', () => {
  it('maps the profile and current officers, leaving out resigned ones', async () => {
    const { adapters, calls } = adaptersWith(companyAnswers());
    const outcome = await adapters.companies_house?.lookUp(COMPANY);
    expect(outcome).toEqual({
      ok: true,
      result: {
        registry: 'companies_house',
        identifier: COMPANY,
        fetchedAt: NOW.toISOString(),
        status: 'active',
        registeredName: 'INVENTED TRADING LIMITED',
        registeredAddress: {
          line1: '2 Invented Road',
          line2: 'Exampleside',
          town: 'Testtown',
          postcode: 'ZZ2 2ZZ',
          countryCode: 'GB',
        },
        registeredOn: '2012-06-14',
        removedOn: null,
        accounts: { periodEnd: '2025-06-30', income: null, expenditure: null },
        accountsOverdue: false,
        officers: [
          { name: 'TESTER, Invented One', role: 'director' },
          { name: 'TESTER, Invented Two', role: 'secretary' },
        ],
      },
    });
    expect(calls.map(({ url }) => url)).toEqual([
      `https://api.company-information.service.gov.uk/company/${COMPANY}`,
      `https://api.company-information.service.gov.uk/company/${COMPANY}/officers?items_per_page=100&start_index=0`,
    ]);
    expect(JSON.stringify(outcome)).not.toContain('never-followed');
  });

  it('sends the key as the Basic user name with no password', async () => {
    const { adapters, calls } = adaptersWith(companyAnswers());
    await adapters.companies_house?.lookUp(COMPANY);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`);
  });

  it('reads a second page of officers, and refuses a list too long to be complete', async () => {
    const page = (count: number, total: number) =>
      json({
        total_results: total,
        items: Array.from({ length: count }, (_, at) => ({
          name: `TESTER, Invented ${at}`,
          officer_role: 'director',
        })),
      });
    const two = adaptersWith((url) =>
      url.includes('/officers') ? page(100, 130) : json(fixture('companies-house-profile')),
    );
    const found = await two.adapters.companies_house?.lookUp(COMPANY);
    expect(found).toMatchObject({ ok: true });
    expect(two.calls).toHaveLength(3);

    const endless = adaptersWith((url) =>
      url.includes('/officers') ? page(100, 5000) : json(fixture('companies-house-profile')),
    );
    expect(await endless.adapters.companies_house?.lookUp(COMPANY)).toEqual({
      ok: false,
      failure: 'response_refused',
    });
  });

  it('treats a company with no officers record as having none', async () => {
    const { adapters } = adaptersWith(companyAnswers({ officers: json({}, 404) }));
    expect(await adapters.companies_house?.lookUp(COMPANY)).toMatchObject({
      ok: true,
      result: { officers: [] },
    });
  });

  it('shows a dissolved or liquidated company as data only', async () => {
    const body = {
      ...(fixture('companies-house-profile') as object),
      company_status: 'liquidation',
    };
    const outcome = await adaptersWith(
      companyAnswers({ profile: json(body) }),
    ).adapters.companies_house?.lookUp(COMPANY);
    expect(outcome).toMatchObject({ ok: true, result: { status: 'in_liquidation' } });
  });
});

describe('failures', () => {
  const lookUp = (answer: Response | (() => Response | Promise<Response>)) =>
    adaptersWith(() =>
      typeof answer === 'function' ? answer() : answer,
    ).adapters.charity_commission?.lookUp(CHARITY);

  it.each([
    ['404', json({}, 404), 'not_found'],
    ['429', json({}, 429), 'rate_limited'],
    ['401', json({}, 401), 'registry_unavailable'],
    ['500', json({}, 500), 'registry_unavailable'],
    [
      'HTML where JSON is expected',
      new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      'response_refused',
    ],
    [
      'JSON that does not parse',
      new Response('{"a":', { headers: { 'content-type': 'application/json' } }),
      'response_refused',
    ],
    [
      'a body over the cap',
      new Response('x'.repeat(MAX_BODY_BYTES + 1), {
        headers: { 'content-type': 'application/json' },
      }),
      'response_refused',
    ],
  ] as const)('ends a %s as %s and stores nothing', async (_, answer, failure) => {
    expect(await lookUp(answer)).toEqual({ ok: false, failure });
  });

  it('ends a failed connection as unavailable, without the message or cause of the error', async () => {
    const leaky = () => {
      throw new TypeError(`fetch failed for https://x.invalid/?key=${KEY}`, {
        cause: new Error(KEY),
      });
    };
    const outcome = await lookUp(leaky);
    expect(outcome).toEqual({ ok: false, failure: 'registry_unavailable' });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('never follows a redirect, so the key goes nowhere else', async () => {
    const { adapters, calls } = adaptersWith(() => json(fixture('charity-commission')));
    await adapters.charity_commission?.lookUp(CHARITY);
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a call over the register limit without making it, so its job retries later', async () => {
    const { adapters, calls } = adaptersWith(() => json(fixture('charity-commission')));
    const outcomes: LookupOutcome[] = [];
    for (let at = 0; at < 6; at++)
      outcomes.push((await adapters.charity_commission?.lookUp(CHARITY)) as LookupOutcome);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true, true, true, true, false]);
    expect(outcomes[5]).toEqual({ ok: false, failure: 'rate_limited' });
    expect(calls).toHaveLength(5);
  });
});

describe('keys', () => {
  it('is off for a register with no key, and has no adapter for the downloaded ones yet', () => {
    const adapters = createRegistryAdapters({ companiesHouse: new Secret(KEY) });
    expect(Object.keys(adapters)).toEqual(['companies_house']);
  });

  it.each([
    ['a found entry', () => json(fixture('charity-commission'))],
    ['a 401', () => json({}, 401)],
    ['a 429', () => json({}, 429)],
    ['a 500', () => json({}, 500)],
    ['a response that is refused', () => json({ charity_name: 1 })],
  ])('keeps the key out of everything but its header, for %s', async (_, answer) => {
    const { adapters, calls } = adaptersWith(answer);
    const outcome = await adapters.charity_commission?.lookUp(CHARITY);
    expect(JSON.stringify(outcome)).not.toContain(KEY);
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.init.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': KEY });
  });

  it('never shows in a log line, JSON document or inspection by accident', () => {
    const secret = new Secret(KEY);
    expect(String(secret)).toBe('[redacted]');
    expect(JSON.stringify({ secret })).not.toContain(KEY);
    expect(JSON.stringify(keys)).not.toContain(KEY);
    expect(String(Object.keys(keys))).not.toContain(KEY);
  });

  it('keeps an adapter result inside the contract schema', async () => {
    const { adapters } = adaptersWith(() => json(fixture('charity-commission')));
    const outcome = await adapters.charity_commission?.lookUp(CHARITY);
    expect(outcome?.ok && registryResultSchema.safeParse(outcome.result).success).toBe(true);
  });
});
