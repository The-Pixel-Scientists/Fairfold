// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The synthetic funding round every design preview draws on, so the screens
// tell one story. Every organisation, person and amount is made up.

export const funder = {
  name: 'Northfield Foundation',
  slug: 'northfield',
  email: 'grants@northfield.example',
  phone: '01632 960123',
};

/** The charity number of Northfield Community Trust. It is not allocated to any real charity. */
export const charityNumber = '1999876';

export const staff = {
  name: 'Ada Morgan',
  role: 'Grants manager',
  email: 'ada.morgan@northfield.example',
};

/** The reviewer the reviewer screens are for. */
export const reviewer = { name: 'Owen Hughes', email: 'owen.hughes@example.org' };

/**
 * The four moments the previews are set at. The statuses of the programmes and
 * rounds in this file are as at 17 March 2027, and a screen set earlier or
 * later says so in its own data.
 */
export const moments = {
  applying: new Date(2027, 1, 15, 16, 0),
  assessing: new Date(2027, 2, 17, 14, 31),
  deciding: new Date(2027, 2, 26, 16, 30),
  released: new Date(2027, 3, 2, 9, 20),
} as const;

export type RoundStatus = 'Draft' | 'Open' | 'Closed' | 'Assessing' | 'Deciding' | 'Complete';

export interface Round {
  id: string;
  name: string;
  status: RoundStatus;
  opens: string;
  closes: string;
  budget: number;
  minimumAward: number;
  maximumAward: number;
  applications: number;
}

export interface Programme {
  id: string;
  name: string;
  summary: string;
  rounds: readonly Round[];
}

export const communityGrants: Programme = {
  id: 'community-grants',
  name: 'Community Grants',
  summary:
    'Grants of £1,000 to £25,000 for community groups in Northfield and the villages around it, for projects that bring people together.',
  rounds: [
    {
      id: 'spring-2027',
      name: 'Spring 2027',
      status: 'Assessing',
      opens: '2 February 2027, 9am',
      closes: '3 March 2027, 5pm',
      budget: 250_000,
      minimumAward: 1_000,
      maximumAward: 25_000,
      applications: 48,
    },
    {
      id: 'summer-2027',
      name: 'Summer 2027',
      status: 'Draft',
      opens: '1 June 2027, 9am',
      closes: '30 June 2027, 5pm',
      budget: 200_000,
      minimumAward: 1_000,
      maximumAward: 25_000,
      applications: 0,
    },
    {
      id: 'autumn-2026',
      name: 'Autumn 2026',
      status: 'Complete',
      opens: '1 September 2026, 9am',
      closes: '30 September 2026, 5pm',
      budget: 230_000,
      minimumAward: 1_000,
      maximumAward: 25_000,
      applications: 52,
    },
  ],
};

export const programmes: readonly Programme[] = [
  communityGrants,
  {
    id: 'green-spaces',
    name: 'Green Spaces Fund',
    summary: 'Up to £40,000 to make parks, gardens and paths greener and easier to reach.',
    rounds: [
      {
        id: 'green-2027',
        name: '2027',
        status: 'Open',
        opens: '11 January 2027, 9am',
        closes: '26 April 2027, 5pm',
        budget: 400_000,
        minimumAward: 5_000,
        maximumAward: 40_000,
        applications: 19,
      },
    ],
  },
  {
    id: 'youth-futures',
    name: 'Youth Futures',
    summary: 'Multi-year support for youth work with young people aged 11 to 25.',
    rounds: [
      {
        id: 'youth-2027',
        name: '2027 to 2030',
        status: 'Draft',
        opens: '6 September 2027, 9am',
        closes: '29 October 2027, 5pm',
        budget: 900_000,
        minimumAward: 30_000,
        maximumAward: 90_000,
        applications: 0,
      },
    ],
  },
  {
    id: 'hardship',
    name: 'Emergency Hardship Fund',
    summary: 'Quick grants for groups helping people through a crisis this winter.',
    rounds: [
      {
        id: 'hardship-2026',
        name: 'Winter 2026',
        status: 'Complete',
        opens: '2 November 2026, 9am',
        closes: '18 December 2026, 5pm',
        budget: 120_000,
        minimumAward: 500,
        maximumAward: 5_000,
        applications: 63,
      },
    ],
  },
];

/** The Spring 2027 rubric: five weighted criteria, each scored 1 to 5. */
export const scale = [
  { score: 1, label: 'Weak' },
  { score: 2, label: 'Limited' },
  { score: 3, label: 'Adequate' },
  { score: 4, label: 'Good' },
  { score: 5, label: 'Strong' },
] as const;

export const criteria = [
  {
    id: 'need',
    label: 'Need',
    weight: 3,
    guidance:
      'Is there clear evidence that people need this, from the group itself, local data or the people it serves?',
  },
  {
    id: 'approach',
    label: 'Approach',
    weight: 2,
    guidance:
      'Is the plan realistic, with clear activities, a timetable and a way to know it worked?',
  },
  {
    id: 'reach',
    label: 'Reach',
    weight: 2,
    guidance: 'Does it reach people who are often left out, and are they involved in shaping it?',
  },
  {
    id: 'value',
    label: 'Value for money',
    weight: 2,
    guidance:
      'Are the costs reasonable and explained, and is other funding or help in kind used well?',
  },
  {
    id: 'capacity',
    label: 'Capacity to deliver',
    weight: 1,
    guidance:
      'Does the group have the people, skills and governance to deliver and account for the grant?',
  },
] as const;

export type ApplicationStatus =
  'Submitted' | 'Ineligible' | 'In review' | 'Shortlisted' | 'Awarded' | 'Waitlisted' | 'Declined';

/** What staff record for an application on the Decisions screen. */
export type Outcome = 'Accept' | 'Waitlist' | 'Decline';

/** One reviewer's weighted total for an application, out of 5. */
export interface Review {
  reviewer: string;
  total: number;
}

export interface Application {
  reference: string;
  organisation: string;
  project: string;
  requested: number;
  /** In full, such as "1 March 2027". */
  submitted: string;
  area: string;
  theme: string;
  /** Why the application cannot go forward. Only the 7 ineligible ones have one. */
  ineligible?: string;
  /** In the order they were submitted. Every eligible application has three. */
  reviews: readonly Review[];
  /** How many of those reviews were in on 17 March 2027. */
  inBy17March: number;
  statusOn17March: ApplicationStatus;
  decision?: Outcome;
  /** What an accepted application is awarded: the amount requested, or less where the panel cut it. */
  amount?: number;
}

/** Ranks 1 to 22 of the eligible applications had been shortlisted by the time the panel met. */
export const shortlistedByDecision = 22;

export const reviewers = [
  { name: 'Priya Shah', email: 'priya.shah@example.org', assigned: 22, submittedBy17March: 20 },
  { name: 'Tom Okafor', email: 'tom.okafor@example.org', assigned: 21, submittedBy17March: 14 },
  { name: 'Hannah Lewis', email: 'hannah.lewis@example.org', assigned: 21, submittedBy17March: 21 },
  { name: 'Daniel Price', email: 'daniel.price@example.org', assigned: 21, submittedBy17March: 12 },
  { name: 'Grace Mbeki', email: 'grace.mbeki@example.org', assigned: 22, submittedBy17March: 16 },
  { name: 'Owen Hughes', email: 'owen.hughes@example.org', assigned: 16, submittedBy17March: 12 },
] as const;

const scoredBy = (name: string) => (total: number) => ({ reviewer: name, total });
const ps = scoredBy('Priya Shah');
const to = scoredBy('Tom Okafor');
const hl = scoredBy('Hannah Lewis');
const dp = scoredBy('Daniel Price');
const gm = scoredBy('Grace Mbeki');
const oh = scoredBy('Owen Hughes');

function eligible(
  reference: string,
  organisation: string,
  project: string,
  requested: number,
  submitted: string,
  area: string,
  theme: string,
  reviews: readonly Review[],
  inBy17March: number,
  statusOn17March: ApplicationStatus,
  decision: Outcome,
  amount = requested,
): Application {
  return {
    reference,
    organisation,
    project,
    requested,
    submitted,
    area,
    theme,
    reviews,
    inBy17March,
    statusOn17March,
    decision,
    ...(decision === 'Accept' && { amount }),
  };
}

function ineligible(
  reference: string,
  organisation: string,
  project: string,
  requested: number,
  submitted: string,
  area: string,
  theme: string,
  reason: string,
): Application {
  return {
    reference,
    organisation,
    project,
    requested,
    submitted,
    area,
    theme,
    ineligible: reason,
    reviews: [],
    inBy17March: 0,
    statusOn17March: 'Ineligible',
  };
}

/** Every application to Spring 2027: the 41 eligible ones by rank, then the 7 that were not. */
export const applications: readonly Application[] = [
  eligible(
    'NF-CG-0371',
    'Hartley Green Befrienders',
    'Tea and a chat visits',
    9_800,
    '23 February 2027',
    'Hartley Green',
    'Older people',
    [gm(4.8), ps(4.5), hl(4.8)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0365',
    'Westfield Refugee Welcome',
    'English conversation cafés',
    22_000,
    '18 February 2027',
    'Westfield',
    'Places',
    [oh(4.6), to(4.4), ps(4.8)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0352',
    'Northfield Repair Café',
    'Mend and make',
    8_400,
    '10 February 2027',
    'Northfield Central',
    'Places',
    [gm(4.6), ps(4.4), dp(4.6)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0412',
    'Northfield Community Trust',
    'Riverside Lunch Club',
    12_500,
    '1 March 2027',
    'Northfield Central',
    'Older people',
    [ps(4.7), hl(4.4), to(4.1)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0394',
    'Sandford Young Carers',
    'Respite days for young carers',
    15_600,
    '1 March 2027',
    'Sandford',
    'Young people',
    [gm(4.3), hl(4.6), dp(4.2)],
    2,
    'In review',
    'Accept',
  ),
  eligible(
    'NF-CG-0405',
    'Eastbrook Community Choir',
    'Choir for everyone',
    5_200,
    '2 March 2027',
    'Eastbrook',
    'Arts',
    [gm(4.7), ps(4.3), to(3.9)],
    2,
    'In review',
    'Accept',
  ),
  eligible(
    'NF-CG-0421',
    'Hartley Green Allotment Society',
    'Raised beds for all',
    4_200,
    '2 March 2027',
    'Hartley Green',
    'Food',
    [oh(4.2), hl(4.0), ps(4.4)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0360',
    'Millbrook Dementia Café',
    'Weekly memory café',
    11_000,
    '17 February 2027',
    'Millbrook',
    'Health',
    [gm(4.2), dp(4.1), ps(4.2)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0383',
    'Oakmere Warm Spaces',
    'Warm space openings',
    17_500,
    '1 March 2027',
    'Oakmere',
    'Places',
    [gm(4.1), hl(4.3), dp(4.0)],
    2,
    'In review',
    'Accept',
  ),
  eligible(
    'NF-CG-0427',
    'Westfield Skills Exchange',
    'Time bank for neighbours',
    13_200,
    '3 March 2027',
    'Westfield',
    'Places',
    [oh(4.0), gm(4.3), ps(4.0)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0409',
    'Brightwater Peer Support',
    'Peer support groups',
    16_400,
    '1 March 2027',
    'Northfield Central',
    'Health',
    [oh(4.2), hl(3.8), dp(4.1)],
    2,
    'In review',
    'Accept',
  ),
  eligible(
    'NF-CG-0347',
    'Eastbrook Food Co-op',
    'Community fridge and pantry',
    19_000,
    '9 February 2027',
    'Eastbrook',
    'Food',
    [to(3.5), hl(4.4), gm(4.1)],
    3,
    'Shortlisted',
    'Accept',
  ),
  eligible(
    'NF-CG-0415',
    '1st Sandford Scout Group',
    'Roof repair for the scout hut',
    20_000,
    '3 March 2027',
    'Sandford',
    'Young people',
    [ps(4.0), dp(4.0), gm(3.9)],
    1,
    'In review',
    'Accept',
    17_700,
  ),
  eligible(
    'NF-CG-0398',
    'Eastbrook Youth Collective',
    'Friday Night Project',
    18_000,
    '27 February 2027',
    'Eastbrook',
    'Young people',
    [ps(4.6), to(3.2), oh(4.0)],
    2,
    'In review',
    'Accept',
    15_000,
  ),
  eligible(
    'NF-CG-0418',
    'Sandford Village Hall',
    'Accessible toilets and ramp',
    24_500,
    '2 March 2027',
    'Sandford',
    'Places',
    [dp(3.6), gm(4.0), oh(3.9)],
    2,
    'In review',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0374',
    'Northfield Time to Talk',
    'Listening line for people who are isolated',
    14_400,
    '1 March 2027',
    'Northfield Central',
    'Health',
    [hl(4.0), dp(3.9), to(3.5)],
    2,
    'In review',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0400',
    'Eastbrook Community Garden Trust',
    'Greenhouse and growing club',
    17_800,
    '2 March 2027',
    'Eastbrook',
    'Food',
    [oh(3.6), gm(3.9), ps(3.8)],
    3,
    'Shortlisted',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0388',
    'Hartley Green Cricket Club',
    'Junior coaching and kit',
    11_200,
    '1 March 2027',
    'Hartley Green',
    'Young people',
    [to(3.3), hl(4.0), dp(3.9)],
    3,
    'Shortlisted',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0422',
    "Westfield Women's Sewing Circle",
    'Sewing for wellbeing',
    9_100,
    '3 March 2027',
    'Westfield',
    'Arts',
    [to(3.2), gm(4.1), ps(3.8)],
    1,
    'In review',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0368',
    'Sandford Baby Bank',
    'Storage for the baby bank',
    8_900,
    '20 February 2027',
    'Sandford',
    'Young people',
    [hl(3.8), dp(3.7), gm(3.5)],
    3,
    'Shortlisted',
    'Waitlist',
  ),
  eligible(
    'NF-CG-0377',
    "St Anne's Food Pantry",
    'Cook and eat sessions',
    9_750,
    '22 February 2027',
    'Millbrook',
    'Food',
    [oh(4.5), dp(3.9), to(2.4)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0389',
    "Northfield Carers' Network",
    'Breaks for carers',
    11_200,
    '25 February 2027',
    'Northfield Central',
    'Health',
    [oh(3.7), gm(3.8), dp(3.1)],
    0,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0356',
    'Kestrel Football for All',
    'Walking football league',
    7_800,
    '15 February 2027',
    'Westfield',
    'Health',
    [oh(3.9), to(3.0), dp(3.3)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0379',
    "Millbrook Mums' Group",
    'Baby massage and chat',
    8_800,
    '1 March 2027',
    'Millbrook',
    'Young people',
    [ps(3.5), to(3.0), hl(3.6)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0434',
    'Sandford Bell Ringers',
    'New bells and training',
    12_500,
    '3 March 2027',
    'Sandford',
    'Arts',
    [ps(3.1), dp(3.4), gm(3.4)],
    1,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0401',
    'Eastbrook Youth Radio',
    'Studio kit for a youth station',
    14_900,
    '2 March 2027',
    'Eastbrook',
    'Young people',
    [hl(3.5), to(2.9), dp(3.3)],
    1,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0436',
    'Hartley Green Boules Club',
    'Covered court for all weathers',
    19_500,
    '3 March 2027',
    'Hartley Green',
    'Places',
    [oh(3.0), gm(3.4), ps(3.2)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0430',
    "Millbrook Men's Shed",
    'Workshop tools and safety',
    6_300,
    '3 March 2027',
    'Millbrook',
    'Older people',
    [hl(3.1), to(2.6), oh(3.7)],
    1,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0343',
    'Northfield Chess in Schools',
    'Chess clubs after school',
    9_400,
    '6 February 2027',
    'Northfield Central',
    'Young people',
    [oh(3.2), to(2.7), hl(3.3)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0420',
    'Oakmere Parish Magazine',
    'Printing and delivery',
    13_100,
    '3 March 2027',
    'Oakmere',
    'Places',
    [ps(2.8), dp(3.1), gm(3.1)],
    1,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0369',
    'Westfield Dance Studio CIC',
    'Dance for the over 60s',
    17_200,
    '22 February 2027',
    'Westfield',
    'Older people',
    [to(2.6), hl(3.2), dp(3.1)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0402',
    'The Lantern Arts Project',
    'Lantern parade 2027',
    15_000,
    '28 February 2027',
    'Northfield Central',
    'Arts',
    [to(1.9), hl(2.7), ps(4.1)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0414',
    'Sandford Cycling Club',
    'Bikes for beginners',
    20_800,
    '2 March 2027',
    'Sandford',
    'Health',
    [gm(3.1), ps(2.9), to(2.6)],
    2,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0385',
    'Eastbrook Pop-up Cinema',
    'Film nights in the park',
    16_250,
    '1 March 2027',
    'Eastbrook',
    'Arts',
    [oh(2.7), hl(3.0), dp(2.7)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0431',
    'Millbrook Beekeepers',
    'Hives and training',
    14_600,
    '3 March 2027',
    'Millbrook',
    'Places',
    [to(2.3), gm(2.9), ps(3.0)],
    1,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0366',
    'Northfield Quiz League',
    'A charity quiz series',
    12_900,
    '19 February 2027',
    'Northfield Central',
    'Arts',
    [hl(2.9), dp(2.5), gm(2.6)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0423',
    'Hartley Green Photography Group',
    'Exhibition and printing',
    15_500,
    '3 March 2027',
    'Hartley Green',
    'Arts',
    [ps(2.5), hl(2.9), to(2.3)],
    2,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0397',
    'Oakmere Walking Trails',
    'Waymarkers and a map',
    16_900,
    '2 March 2027',
    'Oakmere',
    'Places',
    [gm(2.4), ps(2.5), dp(2.6)],
    2,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0408',
    'Westfield Gaming Café',
    'A gaming club for teenagers',
    19_200,
    '2 March 2027',
    'Westfield',
    'Young people',
    [oh(2.5), to(2.0), hl(2.7)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0358',
    'Sandford Coach Trips',
    'Day trips for pensioners',
    17_600,
    '16 February 2027',
    'Sandford',
    'Older people',
    [oh(2.2), dp(2.4), gm(2.3)],
    3,
    'In review',
    'Decline',
  ),
  eligible(
    'NF-CG-0426',
    'Eastbrook Fireworks Committee',
    'A bonfire night display',
    17_000,
    '3 March 2027',
    'Eastbrook',
    'Arts',
    [ps(2.3), hl(2.5), to(1.6)],
    2,
    'In review',
    'Decline',
  ),
  ineligible(
    'NF-CG-0341',
    'Hartley Green Primary PTA',
    'Sensory garden',
    9_400,
    '4 February 2027',
    'Hartley Green',
    'Young people',
    'A school parent-teacher association, for the school grounds. Schools cannot apply.',
  ),
  ineligible(
    'NF-CG-0350',
    'Westfield Community Choir',
    'Singing for wellbeing',
    4_800,
    '11 February 2027',
    'Westfield',
    'Arts',
    'The costs are for sessions that began in January 2027, before a grant could start.',
  ),
  ineligible(
    'NF-CG-0373',
    'Westfield Tenants Association',
    'Warm spaces for winter',
    6_500,
    '26 February 2027',
    'Westfield',
    'Places',
    'The group has no written constitution.',
  ),
  ineligible(
    'NF-CG-0381',
    'Oakmere Library Friends',
    'Saturday story mornings',
    3_500,
    '24 February 2027',
    'Oakmere',
    'Young people',
    "Run by the county council's library service. Councils cannot apply.",
  ),
  ineligible(
    'NF-CG-0416',
    'Oakmere Churches Together',
    'Winter lunch clubs',
    3_800,
    '2 March 2027',
    'Oakmere',
    'Older people',
    'A report on an earlier grant is overdue.',
  ),
  ineligible(
    'NF-CG-0432',
    'Kestrel Gardening Friends',
    'Community orchard',
    2_900,
    '3 March 2027',
    'Westfield',
    'Places',
    'The group has no bank account in its own name.',
  ),
  ineligible(
    'NF-CG-0437',
    'Millbrook Town Football Club Ltd',
    'Pitch drainage',
    6_600,
    '3 March 2027',
    'Millbrook',
    'Health',
    'A company that pays profits to its owners.',
  ),
];

/** The featured application's budget, in pounds. */
export const featuredBudget = [
  { item: 'Hall hire', detail: '48 Tuesdays at £60', cost: 2_880 },
  { item: 'Food and drink', detail: '48 lunches for 40 people at £2.50 each', cost: 4_800 },
  {
    item: 'Minibus hire and fuel',
    detail: 'There and back for 12 people: 48 Tuesdays at £50, plus £220 fuel',
    cost: 2_620,
  },
  { item: 'Cook', detail: '48 Tuesdays at £50 a session', cost: 2_400 },
  { item: 'Food hygiene training', detail: 'Level 2 for 8 volunteers at £25 each', cost: 200 },
  { item: 'Kitchen equipment', detail: 'Hot cupboard £450, second urn £150', cost: 600 },
] as const;

/** Pounds with thousands separators and no pence, as the content style asks: £12,500. */
export function pounds(amount: number): string {
  return `£${amount.toLocaleString('en-GB')}`;
}
