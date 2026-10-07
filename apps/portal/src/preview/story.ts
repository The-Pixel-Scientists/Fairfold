// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The synthetic application every applicant preview draws on, the same story
// as the console's previews. Every organisation, person and amount is made up,
// the phone numbers are in the range Ofcom keeps for drama, and the charity
// number 1999876 is far above any the Charity Commission has issued, so it
// belongs to no charity.

/** The funder's shared inbox and grants line, which every applicant email comes from. */
export const funder = {
  name: 'Northfield Foundation',
  email: 'grants@northfield.example',
  phone: '01632 960123',
};

/** Who applicants reach through the funder's inbox and grants line. */
export const caseOfficer = {
  name: 'Ada Morgan',
  role: 'Grants manager',
  hours: 'Monday to Friday, 9am to 5pm',
};

export const applicant = {
  name: 'Sam Patel',
  role: 'Project lead',
  email: 'sam@example.org',
  phone: '01632 960412',
  organisation: 'Northfield Community Trust',
  charityNumber: '1999876',
  address: 'Riverside Hall, Mill Lane, Northfield, NF1 3QR',
};

export const round = {
  programme: 'Community Grants',
  name: 'Spring 2027',
  summary:
    'Grants of £1,000 to £25,000 for community groups in Northfield and the villages around it, for projects that bring people together.',
  closes: '3 March 2027 at 5pm',
  decisionsBy: '30 April 2027',
  minimumAward: 1_000,
  maximumAward: 25_000,
};

/** The project's costs in pounds, each with the working that gets to its amount. The only list of them. */
export const budget = [
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

/** Other money going into the project. It comes off what the applicant asks for. */
export const otherFunding = [{ source: 'Northfield Parish Council', amount: 1_000 }] as const;

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);

export const totalCost = sum(budget.map(({ cost }) => cost));
export const totalOtherFunding = sum(otherFunding.map(({ amount }) => amount));

export const application = {
  reference: 'NF-CG-0412',
  project: 'Riverside Lunch Club',
  requested: totalCost - totalOtherFunding,
  submitted: '1 March 2027 at 2:14pm',
};

export const sections = [
  { id: 'organisation', title: 'About your organisation' },
  { id: 'project', title: 'Your project' },
  { id: 'budget', title: 'Budget' },
  { id: 'outcomes', title: 'Outcomes' },
  { id: 'documents', title: 'Documents' },
  { id: 'declarations', title: 'Declarations' },
] as const;

/** Pounds with thousands separators and no pence, as the content style asks: £12,500. */
export function pounds(amount: number): string {
  return `£${amount.toLocaleString('en-GB')}`;
}
