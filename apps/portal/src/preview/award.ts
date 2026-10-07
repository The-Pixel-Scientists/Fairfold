// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the funder tells Northfield Community Trust once it has released the
// outcome: the dates, a few words from the case officer, the conditions and
// what happens next. The outcome page and the decision letter both read it.

import type { Step } from './parts.tsx';
import { applicant, application, pounds } from './story.ts';

export const decisionSent = '1 April 2027';
export const acceptBy = '29 April 2027';
export const grantPeriod = '1 June 2027 to 25 April 2028';

export const note =
  'We were glad to read about the lunch club. A hot meal and a friendly face every week is exactly the sort of project this fund is for. We look forward to seeing it start.';

export const conditions = [
  'Spend the grant on the costs in your budget. Ask us first if you need to change how you spend it.',
  'Make sure every volunteer and driver who works with older people has a DBS (Disclosure and Barring Service) check before they start.',
  'Send us a short progress report after six months, and a final report within a month of the project ending.',
  'Tell us if you get other money for the same costs.',
];

const half = application.requested / 2;

export const steps: readonly Step[] = [
  {
    title: 'Accept your grant conditions',
    text: `Accept them by ${acceptBy}, 28 days from your decision. Then we email your grant agreement to ${applicant.email} for your trustees to sign.`,
  },
  {
    title: 'We pay your grant',
    text: `We pay the first ${pounds(half)} within 10 working days of getting your signed agreement. We pay the second ${pounds(half)} after your progress report.`,
  },
  {
    title: 'Start your project',
    text: 'Your grant starts on 1 June 2027. Tell us if your first lunch moves from Tuesday 1 June.',
  },
];
