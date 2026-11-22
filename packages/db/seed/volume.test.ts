// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The volume scenario's data, without a database: its size, that it is the
// same on every run, that every number, phone number, address and postcode
// is invented by the rules in synthetic.ts, and that every organisation,
// person and answer passes the schemas the server checks them with.
// packages/db cannot depend on the party module, which depends on it, so
// its contracts (S03-01) are loaded by path here rather than copied.

import { answersSchema, parseDefinition, validateAnswers } from '@pixel-scientists/domain/forms';
import { permissionsFor, slugSchema } from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { beforeAll, describe, expect, it } from 'vitest';

import { emailOf, type StaffMember } from './scenario.ts';
import {
  isDramaPhone,
  isExampleEmail,
  isFictionalPostcode,
  isInventedIdentifier,
} from './synthetic.ts';
import { generateVolume, volumeTenant, type Volume } from './volume.ts';

interface Schema {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

let party: {
  organisationInputSchema: Schema;
  profileInputSchema: Schema;
};
beforeAll(async () => {
  const contracts = new URL('../../../modules/party/src/contracts/index.ts', import.meta.url).href;
  party = (await import(contracts)) as typeof party;
});

const volume: Volume = generateVolume();
const rounds = (volumeTenant.programmes ?? []).flatMap(({ rounds: list }) => list);
const count = <T>(list: readonly T[], test: (item: T) => boolean) => list.filter(test).length;

describe('the volume scenario', { timeout: 60_000 }, () => {
  it('is at design-partner size, in one valid tenant', () => {
    expect(slugSchema.safeParse(volumeTenant.slug).success).toBe(true);
    expect(tenantNameSchema.safeParse(volumeTenant.name).success).toBe(true);
    expect(volumeTenant.programmes).toHaveLength(3);
    expect(rounds).toHaveLength(6);
    expect(volume.organisations).toHaveLength(2_500);
    expect(volume.people).toHaveLength(3_000);
    expect(volume.applications).toHaveLength(4_000);
    const scores = ([, , role]: StaffMember) =>
      permissionsFor([role], 'console').includes('grants.reviews.score');
    expect(count(volumeTenant.staff, scores)).toBe(40);
    const assessments = volume.applications.flatMap(({ reviews }) => reviews);
    expect(assessments.length).toBeGreaterThan(11_000);
    expect(assessments.length).toBeLessThan(13_000);
    const decisions = volume.applications.flatMap(({ decision }) => (decision ? [decision] : []));
    expect(decisions.length).toBeGreaterThan(1_300);
    expect(decisions.length).toBeLessThan(1_700);
    expect(count(decisions, ({ released }) => released)).toBeGreaterThan(500);
    expect(count(decisions, ({ released }) => !released)).toBeGreaterThan(500);
  });

  it('is the same on every run', () => {
    expect(generateVolume()).toEqual(volume);
  });

  it('has applications in every status and stage, some late, and reviews in each state', () => {
    for (const status of ['draft', 'submitted', 'withdrawn'] as const) {
      expect(
        count(volume.applications, (a) => a.status === status),
        status,
      ).toBeGreaterThan(100);
    }
    for (const stage of [0, 1, 2]) {
      expect(count(volume.applications, (a) => a.stage === stage)).toBeGreaterThan(100);
    }
    const reviews = volume.applications.flatMap(({ reviews: list }) => list);
    expect(count(reviews, (r) => r.submitted)).toBeGreaterThan(5_000);
    expect(count(reviews, (r) => !r.submitted && r.scores.length > 0)).toBeGreaterThan(100);
    expect(count(reviews, (r) => r.scores.length === 0)).toBeGreaterThan(100);
    const late = volume.applications.filter((a) => {
      const round = rounds[a.round];
      const length =
        Date.parse(`${round?.closesAt ?? ''}Z`) - Date.parse(`${round?.opensAt ?? ''}Z`);
      return a.submittedAfter !== null && a.submittedAfter > length;
    });
    expect(late.length).toBeGreaterThan(10);
    for (const { round } of late) expect(rounds[round]?.latePolicy).toBe('accept_and_flag');
  });

  it('gives each organisation one application per round at most, from one of its contacts', () => {
    const seen = new Set<string>();
    for (const application of volume.applications) {
      const key = `${String(application.round)} ${String(application.organisation)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(volume.people[application.applicant]?.contactFor).toContain(application.organisation);
    }
  });

  it('has organisations and people that pass the party schemas as they are stored', () => {
    for (const organisation of volume.organisations) {
      const input = {
        name: organisation.name,
        legalForm: organisation.legalForm,
        identifiers: organisation.identifiers,
        registeredAddress: {
          line1: organisation.addressLine1,
          town: organisation.town,
          postcode: organisation.postcode,
          countryCode: 'GB',
        },
      };
      expect(party.organisationInputSchema.safeParse(input)).toEqual({
        success: true,
        data: input,
      });
      expect(isFictionalPostcode(organisation.postcode)).toBe(true);
      for (const { scheme, identifier } of organisation.identifiers) {
        expect(isInventedIdentifier(scheme, identifier)).toBe(true);
      }
    }
    for (const person of volume.people) {
      const input = {
        givenName: person.givenName,
        familyName: person.familyName,
        ...(person.phone === null ? {} : { phone: person.phone }),
      };
      expect(party.profileInputSchema.safeParse(input)).toEqual({ success: true, data: input });
      expect(person.phone === null || isDramaPhone(person.phone)).toBe(true);
      expect(isExampleEmail(person.email)).toBe(true);
    }
    const emails = [
      ...volume.people.map(({ email }) => email),
      ...volumeTenant.staff.map((member) => emailOf(volumeTenant, member)),
    ];
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(isExampleEmail(email)).toBe(true);
  });

  it('has near-duplicate organisations that share a postcode', () => {
    const byPostcode = new Map<string, string[]>();
    for (const { postcode, name } of volume.organisations) {
      byPostcode.set(postcode, [...(byPostcode.get(postcode) ?? []), name]);
    }
    const pairs = [...byPostcode.values()].filter((names) => names.length > 1);
    expect(pairs.length).toBeGreaterThanOrEqual(50);
    const plain = (name: string) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\b(the|ltd|limited)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const names of pairs) expect(new Set(names.map(plain)).size).toBe(1);
    const kinds = pairs.map(([original = '', copy = '']) =>
      copy === original.toLowerCase()
        ? 'case'
        : copy.startsWith('The ')
          ? 'the'
          : copy.endsWith(' Ltd')
            ? 'ltd'
            : copy.endsWith(' Limited')
              ? 'limited'
              : copy.includes('  ')
                ? 'spacing'
                : 'punctuation',
    );
    expect(new Set(kinds)).toEqual(
      new Set(['case', 'the', 'ltd', 'limited', 'spacing', 'punctuation']),
    );
  });

  it('has organisations claiming an identifier another holds, and people with two', () => {
    const holders = new Map<string, number>();
    for (const { identifiers } of volume.organisations) {
      for (const { scheme, identifier } of identifiers) {
        const key = `${scheme}-${identifier}`;
        holders.set(key, (holders.get(key) ?? 0) + 1);
      }
    }
    expect([...holders.values()].filter((holders) => holders > 1).length).toBeGreaterThanOrEqual(
      30,
    );
    expect(count(volume.people, ({ contactFor }) => contactFor.length > 1)).toBeGreaterThanOrEqual(
      100,
    );
  });

  it('answers each round’s pinned form, in full once submitted', () => {
    const forms = rounds.map((round) => parseDefinition(round.form).data);
    for (const application of volume.applications) {
      const form = forms[application.round];
      if (!form) throw new Error('A round has no valid form.');
      expect(answersSchema.safeParse(application.answers).success).toBe(true);
      const mode = application.status === 'draft' ? 'draft' : 'submit';
      expect(validateAnswers(form, application.answers, mode)).toEqual([]);
      if (application.decision?.amountMinor) {
        const round = rounds[application.round];
        expect(application.decision.amountMinor).toBeGreaterThanOrEqual(
          round?.awardMinMinor ?? Infinity,
        );
        expect(application.decision.amountMinor).toBeLessThanOrEqual(round?.awardMaxMinor ?? 0);
      }
    }
  });
});
