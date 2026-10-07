// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Spring 2027 rubric: story.ts has each criterion's weight and guidance,
// and this adds what each score from 1 to 5 means.

import { criteria } from '../story.ts';

const descriptors: Record<string, readonly string[]> = {
  need: [
    'No evidence of need. The case rests on assumption.',
    'Some evidence, but it is general or out of date, with nothing from local people.',
    'A clear need, supported by one source such as local data or the group’s own experience.',
    'A clear, local need with evidence from more than one source.',
    'Compelling, current evidence from the people it serves and local data, and why now.',
  ],
  approach: [
    'The plan is unclear, with no timetable or way to know whether it worked.',
    'Activities are listed, but timings or measures of success are missing.',
    'A realistic plan with activities, a timetable and a basic way to measure results.',
    'A well-built plan with clear milestones and sensible measures of success.',
    'A strong plan with milestones, named risks and a way to learn as it runs.',
  ],
  reach: [
    'Does not say who it reaches, or leaves out the people most in need.',
    'Names its audience, but does little to reach people who are often left out.',
    'Reaches people who are often left out and asks for their views.',
    'Reaches people who are often left out, and they help to shape the project.',
    'Led by or with the people it serves, who shape and run it.',
  ],
  value: [
    'Costs are missing, unexplained or out of line with the activity.',
    'Some costs are unexplained, or the budget leans heavily on one item.',
    'Costs are reasonable and itemised.',
    'Costs are reasonable and explained, and other funding or help in kind is used.',
    'Excellent value: costs are explained, other funding is secured and help in kind adds to it.',
  ],
  capacity: [
    'No evidence the group can deliver or account for a grant.',
    'Limited experience, with gaps in governance or in who will run it.',
    'The people and basic governance are in place to deliver the project.',
    'Experienced people, sound governance and clear financial controls.',
    'A record of delivering similar work, strong governance and sound finances.',
  ],
};

export interface RubricCriterion {
  id: string;
  label: string;
  guidance: string;
  weight: number;
  /** One for each score, from 1 to 5. */
  descriptors: readonly string[];
}

export const rubric: readonly RubricCriterion[] = criteria.map((criterion) => ({
  ...criterion,
  descriptors: descriptors[criterion.id] ?? [],
}));

export const TOTAL_WEIGHT = 10;

/** The saved rubric. */
export const rubricVersion = { number: 2, saved: '28 January 2027' };
