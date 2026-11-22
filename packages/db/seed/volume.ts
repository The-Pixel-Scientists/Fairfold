// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scenario `volume`, at design-partner size (V1-PLAN "Quality targets for
// V1"), in one tenant, Westmere Community Foundation: 3 programmes with 2
// rounds each, 2,500 organisations, 3,000 applicants, 4,000 applications,
// 40 reviewers, about 12,000 assessments and 1,500 decisions. Two rounds are
// open, with drafts; four have closed, two with their decisions released
// and two with them still private. Some organisations are near-duplicates
// of others, sharing a postcode, some claim an identifier another holds,
// and some applicants are contacts for two organisations.
//
// generateVolume() makes the same data on every run, from a fixed seed and
// the hand-written lists in names.ts; bulk.ts writes it. Ids are made when
// it is written, so a run never clashes with an earlier one.

import {
  costItems,
  familyNames,
  givenNames,
  organisationKinds,
  places,
  projects,
  streets,
} from './names.ts';
import type { Programme, Round, StaffMember, Tenant } from './scenario.ts';
import {
  dramaPhone,
  fictionalPostcode,
  inventedIdentifier,
  inventedRanges,
  type InventedScheme,
} from './synthetic.ts';

const SEED = 20_261_130;
const ORGANISATIONS = 2_500;
const APPLICANTS = 3_000;
const REVIEWERS = 40;
const POOL = 20;
/** Organisations from here on are near-duplicates of the first ones. */
const DUPLICATES_FROM = 2_440;
/** Organisations from here up to DUPLICATES_FROM claim another's identifier. */
const CLAIMS_FROM = 2_400;
/** People who are contacts for two organisations: the first CONTACTS_TWICE. */
const CONTACTS_TWICE = 150;

const DAY = 86_400_000;

/** A pseudo-random number in [0, 1) from mulberry32, the same sequence on every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Random = ReturnType<typeof generator>;
const pick = <T>(random: Random, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;
const between = (random: Random, low: number, high: number) =>
  low + Math.floor(random() * (high - low + 1));

function shuffled<T>(random: Random, list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** A form for a programme's awards, between `min` and `max` pounds. */
function volumeForm(min: number, max: number) {
  return {
    sections: [
      {
        id: 's_eligibility',
        title: 'Check you can apply',
        fields: [
          {
            id: 'f_local',
            type: 'yes_no',
            label: 'Does your group work with people who live in our area?',
            required: true,
            eligibility: {
              stopWhen: false,
              explanation: 'We fund groups that work with people who live in our area.',
            },
          },
        ],
      },
      {
        id: 's_project',
        title: 'Your project',
        fields: [
          {
            id: 'f_title',
            type: 'short_text',
            label: 'Project name',
            required: true,
            maxCharacters: 120,
          },
          {
            id: 'f_summary',
            type: 'long_text',
            label: 'What will you do, and who will it help?',
            required: true,
            maxWords: 500,
          },
          {
            id: 'f_amount',
            type: 'currency',
            label: 'How much are you asking for?',
            required: true,
            minMinor: min * 100,
            maxMinor: max * 100,
          },
          {
            id: 'f_budget',
            type: 'table',
            label: 'What will the grant pay for?',
            required: true,
            rowNoun: 'cost',
            minRows: 1,
            columns: [
              { id: 'c_item', type: 'short_text', label: 'Item' },
              { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
            ],
          },
        ],
      },
    ],
  };
}

const templates: Programme['templates'] = {
  accepted: {
    subject: '{{programme_title}}: we are offering you a grant',
    body: 'Dear {{given_name}},\n\nWe are pleased to offer {{organisation_name}} a grant of {{award_amount}}.\n\n{{portal_link}}',
  },
  waitlisted: {
    subject: '{{programme_title}}: your application is on our waiting list',
    body: 'Dear {{given_name}},\n\nYour application for {{organisation_name}} is on our waiting list.\n\n{{portal_link}}',
  },
  declined: {
    subject: '{{programme_title}}: the decision on your application',
    body: 'Dear {{given_name}},\n\nWe have decided not to offer {{organisation_name}} a grant this time.\n\n{{portal_link}}',
  },
};

const criteria = [
  { label: 'Need', guidance: 'Is there clear evidence that people need this?', weight: 3 },
  { label: 'Approach', guidance: 'Is the plan realistic, with a timetable?', weight: 2 },
  { label: 'Value for money', guidance: 'Are the costs reasonable and explained?', weight: 1 },
];

/** A local time `days` from seeding, so an open round is open whenever the seed runs. */
const fromSeeding = (days: number, time: string) =>
  `${new Date(Date.now() + days * DAY).toISOString().slice(0, 10)}T${time}`;

/** Each round: when it ran, how many apply, and whether its decisions are released. */
interface RoundPlan {
  readonly programme: 0 | 1 | 2;
  readonly title: string;
  readonly opensAt: string;
  readonly closesAt: string;
  /** For an open round, how many days ago it opened; null once it has closed. */
  readonly openFor: number | null;
  readonly released: boolean;
  readonly applications: number;
}

const roundPlans: readonly RoundPlan[] = [
  {
    programme: 0,
    title: 'Spring 2025',
    opensAt: '2025-03-03T09:00',
    closesAt: '2025-04-14T17:00',
    openFor: null,
    released: true,
    applications: 750,
  },
  {
    programme: 0,
    title: 'Now open',
    opensAt: fromSeeding(-14, '09:00'),
    closesAt: fromSeeding(21, '17:00'),
    openFor: 14,
    released: false,
    applications: 500,
  },
  {
    programme: 1,
    title: 'Autumn 2025',
    opensAt: '2025-09-01T09:00',
    closesAt: '2025-10-13T17:00',
    openFor: null,
    released: true,
    applications: 750,
  },
  {
    programme: 1,
    title: 'Summer 2026',
    opensAt: '2026-06-01T09:00',
    closesAt: '2026-07-13T17:00',
    openFor: null,
    released: false,
    applications: 750,
  },
  {
    programme: 2,
    title: 'Winter 2026',
    opensAt: '2026-01-12T09:00',
    closesAt: '2026-02-23T17:00',
    openFor: null,
    released: false,
    applications: 750,
  },
  {
    programme: 2,
    title: 'Rolling',
    opensAt: fromSeeding(-7, '09:00'),
    closesAt: fromSeeding(28, '17:00'),
    openFor: 7,
    released: false,
    applications: 500,
  },
];

const programmes = [
  {
    title: 'Neighbourhood Grants',
    summary: 'Grants of £1,000 to £10,000 for small groups in our area.',
    min: 1_000,
    max: 10_000,
    budget: 400_000,
  },
  {
    title: 'Community Buildings Fund',
    summary: 'Grants of £5,000 to £25,000 to improve the buildings groups run.',
    min: 5_000,
    max: 25_000,
    budget: 1_500_000,
  },
  {
    title: 'Green Futures',
    summary: 'Grants of £10,000 to £50,000 for projects that help nature and cut energy use.',
    min: 10_000,
    max: 50_000,
    budget: 2_500_000,
  },
] as const;

/** Staff: an administrator, two programme managers and 40 reviewers, each a different pair of names. */
const staff: StaffMember[] = Array.from({ length: 3 + REVIEWERS }, (_, i) => [
  givenNames[(i * 7) % givenNames.length] ?? 'Ada',
  familyNames[(i * 11 + 3) % familyNames.length] ?? 'Morgan',
  i === 0 ? 'tenant_admin' : i < 3 ? 'programme_manager' : 'reviewer',
]);
const reviewerNames = staff.slice(3).map(([given, family]) => [given, family] as const);

export const VOLUME_ROUNDS = roundPlans.length;

/** The tenant, its staff, programmes, rounds, forms and pools, written as any scenario is. */
export const volumeTenant: Tenant = {
  slug: 'westmere',
  name: 'Westmere Community Foundation',
  staff,
  programmes: programmes.map((programme, index) => ({
    title: programme.title,
    summary: programme.summary,
    description: `${programme.summary} Read the guidance before you apply.`,
    status: roundPlans.some((plan) => plan.programme === index && plan.openFor !== null)
      ? 'open'
      : 'closed',
    templates,
    rounds: roundPlans
      .map((plan, round) => ({ plan, round }))
      .filter(({ plan }) => plan.programme === index)
      .map(({ plan, round }): Round => ({
        title: plan.title,
        opensAt: plan.opensAt,
        closesAt: plan.closesAt,
        timezone: 'Europe/London',
        budgetMinor: programme.budget * 100,
        awardMinMinor: programme.min * 100,
        awardMaxMinor: programme.max * 100,
        latePolicy: round % 2 === 0 ? 'accept_and_flag' : 'refuse',
        stages: [{ name: 'Intake' }, { name: 'Review', criteria }, { name: 'Decision' }],
        form: volumeForm(programme.min, programme.max),
        reviewers: Array.from(
          { length: POOL },
          (_, j) => reviewerNames[(round * 10 + j) % REVIEWERS] ?? ['Ada', 'Morgan'],
        ),
      })),
  })),
};

export interface VolumeOrganisation {
  readonly name: string;
  readonly legalForm: string;
  readonly addressLine1: string;
  readonly town: string;
  readonly postcode: string;
  readonly identifiers: readonly { readonly scheme: InventedScheme; readonly identifier: string }[];
}

export interface VolumePerson {
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string;
  readonly phone: string | null;
  /** Indexes of the organisations they are a contact for. */
  readonly contactFor: readonly number[];
}

export interface VolumeReview {
  /** Index into the round's pool. */
  readonly reviewer: number;
  readonly scores: readonly number[];
  readonly submitted: boolean;
}

export interface VolumeApplication {
  readonly round: number;
  readonly organisation: number;
  readonly applicant: number;
  readonly status: 'draft' | 'submitted' | 'withdrawn';
  readonly answers: Readonly<Record<string, unknown>>;
  /** Times after the round opens, in milliseconds. */
  readonly startedAfter: number;
  readonly submittedAfter: number | null;
  readonly withdrawnAfter: number | null;
  /** Index of the stage it reached; null for a draft. */
  readonly stage: number | null;
  readonly reviews: readonly VolumeReview[];
  readonly decision: {
    readonly outcome: 'accepted' | 'waitlisted' | 'declined';
    readonly amountMinor: number | null;
    readonly released: boolean;
  } | null;
}

export interface Volume {
  readonly organisations: readonly VolumeOrganisation[];
  readonly people: readonly VolumePerson[];
  readonly applications: readonly VolumeApplication[];
}

const SCHEMES: Readonly<Record<string, readonly InventedScheme[]>> = {
  registered_charity: ['GB-CHC'],
  charitable_incorporated_organisation: ['GB-CHC'],
  company_limited_by_guarantee: ['GB-COH', 'GB-CHC'],
  community_interest_company: ['GB-COH'],
  community_benefit_society: ['GB-MPR'],
};

/** Near-duplicate names: by case, punctuation, "The", "Ltd" or "Limited", and spacing. */
const variants: readonly ((name: string) => string)[] = [
  (name) => name.toLowerCase(),
  (name) => name.replace(' ', ', '),
  (name) => `The ${name}`,
  (name) => `${name} Ltd`,
  (name) => `${name} Limited`,
  (name) => name.replace(' ', '  '),
];

function organisationsOf(random: Random): VolumeOrganisation[] {
  const names = shuffled(
    random,
    places.flatMap((place) =>
      organisationKinds.map(
        ([name, legalForm]) => [name.replace('{place}', place), legalForm, place] as const,
      ),
    ),
  );
  const used = new Map<InventedScheme, number>();
  const next = (scheme: InventedScheme) => {
    const k = used.get(scheme) ?? 0;
    used.set(scheme, k + 1);
    // Steps of 37, which shares no factor with any range's size, spread the numbers without repeats.
    const { first, last } = inventedRanges[scheme];
    return inventedIdentifier(scheme, (k * 37) % (last - first + 1));
  };
  const organisations: VolumeOrganisation[] = [];
  for (let i = 0; i < ORGANISATIONS; i += 1) {
    if (i >= DUPLICATES_FROM) {
      const original = organisations[i - DUPLICATES_FROM];
      if (!original) throw new Error('A near-duplicate has no original.');
      const variant = variants[i % variants.length] ?? ((name: string) => name);
      organisations.push({ ...original, name: variant(original.name), identifiers: [] });
      continue;
    }
    const [name, legalForm, town] = names[i] ?? names[0] ?? ['', '', ''];
    let identifiers: VolumeOrganisation['identifiers'] = (SCHEMES[legalForm] ?? [])
      .filter((_, index) => index === 0 || random() < 0.5)
      .map((scheme) => {
        const charity =
          scheme === 'GB-CHC'
            ? random() < 0.8
              ? 'GB-CHC'
              : random() < 0.5
                ? 'GB-SC'
                : 'GB-NIC'
            : scheme;
        return { scheme: charity, identifier: next(charity) };
      });
    if (i >= CLAIMS_FROM) {
      // An applicant typed a number another organisation already holds: a claim, not a link (ADR 0025).
      const holder = organisations.find(
        (other, index) => index >= (i - CLAIMS_FROM) * 37 && other.identifiers.length > 0,
      );
      identifiers = holder
        ? [holder.identifiers[0] ?? { scheme: 'GB-CHC', identifier: next('GB-CHC') }]
        : identifiers;
    }
    const building = random() < 0.3;
    organisations.push({
      name,
      legalForm,
      addressLine1: building
        ? `${name.split(' ').at(-1) ?? 'Community'} House, ${pick(random, streets)}`
        : `${String(between(random, 1, 180))} ${pick(random, streets)}`,
      town,
      postcode: fictionalPostcode(i * 13),
      identifiers,
    });
  }
  return organisations;
}

function peopleOf(random: Random, slug: string): VolumePerson[] {
  const pairs = shuffled(
    random,
    givenNames.flatMap((given) => familyNames.map((family) => [given, family] as const)),
  );
  return Array.from({ length: APPLICANTS }, (_, i): VolumePerson => {
    const [givenName, familyName] = pairs[i] ?? ['Ada', 'Morgan'];
    const contactFor =
      i < ORGANISATIONS
        ? i < CONTACTS_TWICE
          ? [i, ORGANISATIONS / 2 + i]
          : [i]
        : [((i - ORGANISATIONS) * 5) % ORGANISATIONS];
    return {
      givenName,
      familyName,
      email: `${givenName}.${familyName}@applicants.${slug}.example`.toLowerCase(),
      phone: random() < 0.5 ? dramaPhone(i) : null,
      contactFor,
    };
  });
}

/** Answers to a programme's form, in full or, for a draft, only the first questions. */
function answersFor(
  random: Random,
  programme: (typeof programmes)[number],
  draft: boolean,
  local: boolean,
) {
  const [title, what] = pick(random, projects);
  if (draft) return random() < 0.5 ? { f_local: local } : { f_local: local, f_title: title };
  const total = between(random, programme.min / 100, programme.max / 100) * 100;
  const rows = between(random, 1, 3);
  const items = shuffled(random, costItems).slice(0, rows);
  const costs = items.map((_, index) =>
    index < rows - 1 ? Math.floor(total / rows / 10) * 10 : 0,
  );
  costs[rows - 1] = total - costs.reduce((sum, cost) => sum + cost, 0);
  const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });
  return {
    f_local: true,
    f_title: title,
    f_summary: `We will ${what}. Local people asked for this at our open meetings, and our volunteers will run it.`,
    f_amount: pounds(total),
    f_budget: items.map((item, index) => ({ c_item: item, c_cost: pounds(costs[index] ?? 0) })),
  };
}

function applicationsOf(
  random: Random,
  organisations: readonly VolumeOrganisation[],
  people: readonly VolumePerson[],
) {
  const contacts = new Map<number, number[]>();
  people.forEach((person, index) => {
    for (const organisation of person.contactFor)
      contacts.set(organisation, [...(contacts.get(organisation) ?? []), index]);
  });
  const applications: VolumeApplication[] = [];
  roundPlans.forEach((plan, round) => {
    const programme = programmes[plan.programme];
    // As wall-clock times, so the sequence is the same in every time zone.
    const length = Date.parse(`${plan.closesAt}Z`) - Date.parse(`${plan.opensAt}Z`);
    const open = plan.openFor !== null;
    // In an open round, everything so far happened before the seed runs.
    const window = plan.openFor === null ? length : plan.openFor * DAY - 3_600_000;
    for (const organisation of shuffled(
      random,
      organisations.map((_, index) => index),
    ).slice(0, plan.applications)) {
      const roll = random();
      const status = open && roll < 0.3 ? 'draft' : roll > 0.95 ? 'withdrawn' : 'submitted';
      const startedAfter = Math.floor(random() * window * 0.8);
      const late = !open && round % 2 === 0 && random() < 0.03;
      const submittedAfter =
        status === 'draft'
          ? null
          : late
            ? length + between(random, 1, 120) * 60_000
            : between(random, startedAfter + 3_600_000, window - 7_200_000);
      const withdrawnAfter =
        status === 'withdrawn' && submittedAfter !== null
          ? submittedAfter + 1 + Math.floor(random() * (open ? window - submittedAfter : 10 * DAY))
          : null;
      const reach = random();
      const stage =
        status === 'draft'
          ? null
          : status === 'withdrawn' || open || reach < 0.1
            ? 0
            : reach < 0.47
              ? 1
              : 2;
      const reviews =
        stage === null || stage === 0
          ? []
          : shuffled(
              random,
              Array.from({ length: POOL }, (_, j) => j),
            )
              .slice(0, stage === 2 ? 5 : 4)
              .map((reviewer): VolumeReview => {
                const done = stage === 2 || random() < 0.6;
                const count = done
                  ? criteria.length
                  : random() < 0.6
                    ? between(random, 1, criteria.length - 1)
                    : 0;
                return {
                  reviewer,
                  scores: Array.from({ length: count }, () => between(random, 1, 5)),
                  submitted: done,
                };
              });
      const answers = answersFor(
        random,
        programme,
        status === 'draft',
        !(status === 'draft' && random() < 0.2),
      );
      const asked = (answers as { f_amount?: { amountMinor: number } }).f_amount?.amountMinor ?? 0;
      const outcomeRoll = random();
      const decision =
        stage === 2
          ? {
              outcome:
                outcomeRoll < 0.4
                  ? ('accepted' as const)
                  : outcomeRoll < 0.55
                    ? ('waitlisted' as const)
                    : ('declined' as const),
              amountMinor:
                outcomeRoll < 0.4
                  ? Math.max(
                      programme.min * 100,
                      Math.floor((asked * between(random, 70, 100)) / 100 / 10_000) * 10_000,
                    )
                  : null,
              released: plan.released,
            }
          : null;
      const own = contacts.get(organisation) ?? [0];
      applications.push({
        round,
        organisation,
        applicant: own.length > 1 && random() < 0.3 ? (own[1] ?? 0) : (own[0] ?? 0),
        status,
        answers,
        startedAfter,
        submittedAfter,
        withdrawnAfter,
        stage,
        reviews,
        decision,
      });
    }
  });
  return applications;
}

/** The volume scenario's organisations, people and applications, the same on every run. */
export function generateVolume(slug = volumeTenant.slug): Volume {
  const random = generator(SEED);
  const organisations = organisationsOf(random);
  const people = peopleOf(random, slug);
  return { organisations, people, applications: applicationsOf(random, organisations, people) };
}
