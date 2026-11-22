// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wave1 scenario's data, without a database: every name, address,
// postcode and identifier it writes follows the seed's synthetic rules, and
// every value passes the contract the server checks it with. packages/db
// cannot depend on the modules, which depend on it, so their contracts are
// loaded by path, as synthetic.test.ts does.

import { parseDefinition, validateAnswers } from '@pixel-scientists/domain/forms';
import { switchableModuleIds } from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { beforeAll, describe, expect, it } from 'vitest';

import { familyNames, givenNames } from '../../names.ts';
import { applicantEmailOf, applicationsOf, emailOf } from '../../scenario.ts';
import {
  inventedIdentifier,
  isExampleEmail,
  isFictionalPostcode,
  isInventedIdentifier,
} from '../../synthetic.ts';
import { screeningCases } from './parts/assure.ts';
import {
  candidatePairs,
  charitySegment,
  duplicatePeople,
  lookAlikes,
  mergeBasisText,
  mergedPair,
} from './parts/crm.ts';
import {
  designedCells,
  monitoringForm,
  PRIVACY_NOTICE_VERSION,
  responsesFor,
} from './parts/monitoring.ts';
import { listFamilyNames } from './sanctions.ts';
import { neighbourhoodForm, wave1Tenants } from './tenants.ts';
import { personEmail, type Organisation } from './write.ts';

interface Schema {
  safeParse(value: unknown): { success: boolean };
}

let grants: {
  monitoringDefinitionProblems(definition: unknown): unknown[];
  monitoringResponseInputSchema: Schema;
};
let insight: { disclosureFloor: { threshold: number; minimumGroup: number } };
let crm: {
  segmentInputSchema: Schema;
  listInputSchema: Schema;
  previewBasisText(basis: unknown): string;
};
let party: {
  organisationInputSchema: Schema;
  mergeCountsSchema: Schema;
  profileInputSchema: Schema;
};

const contracts = (module: string) =>
  import(new URL(`../../../../../modules/${module}/src/contracts/index.ts`, import.meta.url).href);

beforeAll(async () => {
  [grants, insight, crm, party] = (await Promise.all(
    ['grants', 'insight', 'crm', 'party'].map(contracts),
  )) as [typeof grants, typeof insight, typeof crm, typeof party];
});

const [linnetford] = wave1Tenants;
const rounds = linnetford?.programmes?.[0]?.rounds ?? [];

/** A designed round's cells. */
function cellsOf(title: string) {
  const design = designedCells[title];
  if (design === undefined) throw new Error(`No cells are designed for ${title}.`);
  return design.cells;
}

const organisations: Organisation[] = [
  ...wave1Tenants.flatMap((tenant) => applicationsOf(tenant).map((a) => a.organisation)),
  ...candidatePairs.flat(),
  ...lookAlikes.postcode,
  ...lookAlikes.identifier,
  ...mergedPair,
];

const people: (readonly [string, string])[] = [
  ...wave1Tenants.flatMap((tenant) => [
    ...tenant.staff.map(([given, family]) => [given, family] as const),
    ...applicationsOf(tenant).map((a) => a.applicant),
  ]),
  ...duplicatePeople.map(({ name }) => name),
];

describe('the wave1 tenants', () => {
  it('have valid names, slugs of their own and tools from the switchable list', () => {
    const slugs = wave1Tenants.map((tenant) => tenant.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const tenant of wave1Tenants) {
      expect(tenantNameSchema.safeParse(tenant.name).success).toBe(true);
      for (const tool of tenant.tools) expect(switchableModuleIds).toContain(tool);
    }
    expect(wave1Tenants.map((tenant) => tenant.tools)).toEqual([
      ['grants', 'crm', 'assure', 'forms', 'privacy', 'insight'],
      ['grants'],
      ['crm', 'assure'],
    ]);
  });

  it('give every account an address of its own under .example', () => {
    for (const tenant of wave1Tenants) {
      const emails = [
        ...tenant.staff.map((member) => emailOf(tenant, member)),
        ...applicationsOf(tenant).map(({ applicant }) => applicantEmailOf(tenant, applicant)),
      ];
      expect(new Set(emails).size).toBe(emails.length);
      for (const email of emails) expect(isExampleEmail(email), email).toBe(true);
    }
  });

  it('answer the application form as the server would accept them', () => {
    const parsed = parseDefinition(neighbourhoodForm);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(rounds.map((round) => round.applications?.length)).toEqual([62, 10]);
    for (const { answers } of rounds.flatMap((round) => round.applications ?? [])) {
      expect(validateAnswers(parsed.data, answers, 'submit')).toEqual([]);
    }
  });
});

describe('every value the wave1 scenario writes', () => {
  it('takes names from the hand-written lists', () => {
    // One screening case misspells a list name on purpose.
    const surnames = new Set<string>([...familyNames, ...listFamilyNames, 'Calderiwck']);
    for (const [given, family] of [...people, ...screeningPeople()]) {
      expect(givenNames, given).toContain(given);
      expect(surnames, family).toContain(family);
    }
  });

  it('uses fictional postcodes and passes the party contract for organisations', () => {
    for (const o of organisations) {
      expect(isFictionalPostcode(o.postcode), o.postcode).toBe(true);
      const input = {
        name: o.name,
        legalForm: o.legalForm,
        identifiers: [],
        registeredAddress: { line1: o.addressLine1, town: o.town, postcode: o.postcode },
      };
      expect(party.organisationInputSchema.safeParse(input).success, o.name).toBe(true);
    }
  });

  it('invents its charity numbers and keeps people under .example', () => {
    for (const n of [100, 101]) {
      expect(isInventedIdentifier('GB-CHC', inventedIdentifier('GB-CHC', n))).toBe(true);
    }
    for (const tenant of wave1Tenants) {
      for (const { name, labels } of duplicatePeople) {
        for (const label of labels)
          expect(isExampleEmail(personEmail(tenant, label, name))).toBe(true);
      }
      for (const person of screeningPeople()) {
        expect(isExampleEmail(personEmail(tenant, 'screening', person))).toBe(true);
      }
    }
    for (const person of [...people, ...screeningPeople()]) {
      const [givenName, familyName] = person;
      expect(party.profileInputSchema.safeParse({ givenName, familyName }).success).toBe(true);
    }
  });
});

function screeningPeople(): (readonly [string, string])[] {
  return screeningCases.flatMap((screening) => ('person' in screening ? [screening.person] : []));
}

describe('the crm data', () => {
  it('has lists and a segment the crm contracts accept', () => {
    expect(
      crm.segmentInputSchema.safeParse({ name: 'Registered charities', filters: charitySegment })
        .success,
    ).toBe(true);
    for (const name of ['Records to check', 'Heritage groups']) {
      expect(crm.listInputSchema.safeParse({ name }).success).toBe(true);
    }
  });

  it("hashes the merge preview as crm's previewBasisText() writes it", () => {
    const [loserId, survivorId] = [
      '5b9a2f0e-6f4c-4c1e-9d3a-1f2e3d4c5b6a',
      '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    ];
    const basis = {
      loserId,
      survivorId,
      kind: 'organisation',
      fields: [],
      conflicts: [],
      counts: {},
      linkRule: 'none',
      links: [],
    };
    expect(mergeBasisText(loserId, survivorId)).toBe(crm.previewBasisText(basis));
    expect(party.mergeCountsSchema.safeParse({}).success).toBe(true);
  });

  it('pairs candidates on one postcode, and keeps look-alikes apart by postcode', () => {
    for (const [a, b] of candidatePairs) expect(a.postcode).toBe(b.postcode);
    const [first, second] = lookAlikes.postcode;
    expect(first.name).toBe(second.name);
    expect(first.postcode).not.toBe(second.postcode);
  });
});

describe('the monitoring data', () => {
  it("is a form of grants' question set, with answers the server would accept", () => {
    const parsed = parseDefinition(monitoringForm);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(grants.monitoringDefinitionProblems(parsed.data)).toEqual([]);
    for (const { cells } of Object.values(designedCells)) {
      for (const answers of responsesFor(cells)) {
        expect(validateAnswers(parsed.data, answers, 'submit')).toEqual([]);
        const input = {
          formVersionId: '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
          answers,
          consent: true,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        };
        expect(grants.monitoringResponseInputSchema.safeParse(input).success).toBe(true);
      }
    }
  });

  it("is designed against insight's platform floor", () => {
    // The counts below are written for this floor.
    expect(insight.disclosureFloor).toEqual({ threshold: 10, minimumGroup: 20 });
    const { threshold, minimumGroup } = insight.disclosureFloor;
    const spring = cellsOf('Spring 2026');
    const counts = (field: string) => new Map(spring[field]);
    expect([...counts('f_agegroup').values()]).toEqual(
      expect.arrayContaining([0, 1, threshold - 1, threshold, threshold + 1]),
    );
    const ethnic = [...counts('f_ethnicgroup').values()];
    expect(ethnic.filter((count) => count < threshold)).toHaveLength(1);
    const responses = responsesFor(spring);
    expect((counts('f_sex').get('prefer_not_to_say') ?? 0) / responses.length).toBeGreaterThan(0.2);
    expect(responsesFor(cellsOf('Summer 2026')).length).toBeLessThan(minimumGroup);
    for (const option of Object.values(cellsOf('Summer 2026')).flat()) {
      expect(option[1]).toBeLessThan(threshold);
    }
  });

  it('has responses that prefer not to say to everything, and applications that skipped the step', () => {
    for (const [title, { skipped, cells }] of Object.entries(designedCells)) {
      const responses = responsesFor(cells);
      const everything = responses.filter((answers) =>
        Object.values(answers).every((answer) => answer === 'prefer_not_to_say'),
      );
      expect(everything.length, title).toBeGreaterThan(0);
      expect(skipped, title).toBeGreaterThan(0);
      const round = rounds.find((r) => r.title === title);
      expect(round?.applications).toHaveLength(responses.length + skipped);
    }
  });
});
