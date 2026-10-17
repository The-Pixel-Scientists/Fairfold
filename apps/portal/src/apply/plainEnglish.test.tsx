// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words on each apply screen suit a reading age of about 11
// (docs/CONTENT-STYLE.md): short sentences, buttons that say what happens, no
// apology or blame, and nothing that hints at an outcome.

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stubApi } from '../testing/api.ts';
import {
  APPLICATION_ID,
  ROUND_ID,
  application,
  applicationList,
  applicationServer,
  completeAnswers,
  openRoundList,
  round,
  roundDetail,
  summary,
} from '../testing/apply.ts';
import { organisation, organisationList, signedIn } from '../testing/party.ts';
import { openPortal, sentencesIn, setUpPortalTests } from '../testing/render.tsx';

setUpPortalTests();

/** The page has shown its heading and finished reading what it shows. */
async function settled() {
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => {
    expect(screen.queryByText(/^Loading/)).toBeNull();
  });
}

const home = `/northfield/applications/${APPLICATION_ID}`;
const reads = (start = application()) => ({
  ...signedIn,
  ...applicationServer(start).handlers,
  'GET /portal/rounds': openRoundList(round),
  [`GET /portal/rounds/${ROUND_ID}`]: roundDetail(),
  'GET /portal/organisations': organisationList(organisation()),
  'GET /portal/applications': applicationList(
    summary(),
    summary({
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      status: 'submitted',
      submittedAt: '2026-10-21T12:00:00.000Z',
    }),
  ),
});

const eligible = application({ answers: { f_charity: true } });

const screens = [
  ['programmes', '/northfield/programmes', reads()],
  [
    'programmes, with none open',
    '/northfield/programmes',
    { ...reads(), 'GET /portal/rounds': openRoundList() },
  ],
  ['a round', `/northfield/programmes/${ROUND_ID}`, reads()],
  ['who is applying', `/northfield/programmes/${ROUND_ID}/start`, reads()],
  [
    'who is applying, with no organisation',
    `/northfield/programmes/${ROUND_ID}/start`,
    { ...reads(), 'GET /portal/organisations': organisationList() },
  ],
  ['your applications', '/northfield/applications', reads()],
  [
    'your applications, with none',
    '/northfield/applications',
    { ...reads(), 'GET /portal/applications': applicationList() },
  ],
  ['the application, to start', home, reads()],
  ['the application, part way', home, reads(eligible)],
  [
    'the application, not allowed to apply',
    home,
    reads(application({ answers: { f_charity: false } })),
  ],
  ['the eligibility questions', `${home}/eligibility`, reads()],
  [
    'the eligibility questions, with a stop',
    `${home}/eligibility`,
    reads(application({ answers: { f_charity: false } })),
  ],
  ['a section', `${home}/sections/s_about`, reads(eligible)],
  ['the budget', `${home}/sections/s_budget`, reads(eligible)],
  ['a section, locked', `${home}/sections/s_about`, reads()],
  ['check your answers, with things to fix', `${home}/check`, reads(eligible)],
  ['check your answers, ready', `${home}/check`, reads(application({ answers: completeAnswers }))],
  [
    'application submitted',
    `${home}/submitted`,
    reads(application({ status: 'submitted', submittedAt: '2026-10-21T12:00:00.000Z' })),
  ],
] as const;

describe.each(screens)('%s', (_name, path, handlers) => {
  it('keeps every sentence short, and never apologises, blames the person or hints at an outcome', async () => {
    stubApi(handlers);
    openPortal(path);
    await settled();

    const main = screen.getByRole('main');
    for (const sentence of sentencesIn(main)) {
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    }
    expect(main.textContent).not.toMatch(
      /sorry|apolog|your fault|invalid|verif|score|shortlist|reviewer|likely|chance of|successful/i,
    );
  });

  it('uses buttons and links that say what happens, never a bare "Submit" or "OK"', async () => {
    stubApi(handlers);
    openPortal(path);
    await settled();

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(control.textContent).not.toMatch(/^(submit|ok|click here|here|next|save|add|edit)$/i);
    }
  });
});
