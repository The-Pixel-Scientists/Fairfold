// SPDX-License-Identifier: AGPL-3.0-or-later

import { myResponsePageSchema } from '@pixel-scientists/forms/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { challengeReply, publicForm } from '../testing/forms.ts';
import { applicantSession, stubApi } from '../testing/api.ts';
import { ok } from '../testing/party.ts';
import { organisationList } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';
import { newProfile } from '../testing/party.ts';

vi.mock('../../../../modules/forms/src/portal/proof.ts', () => ({
  solveInWorker: vi.fn(() => Promise.resolve(Array.from({ length: 16 }, (_, index) => index))),
}));

setUpPortalTests();

const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';
const RESPONSE_ID = '5e7f9a1b-3c5d-4e7f-8a9b-0c1d2e3f4a5b';

const signedIn = (modules: Parameters<typeof applicantSession>[0] = {}) => ({
  'GET /auth/session': { status: 200, body: applicantSession(modules) },
  'GET /portal/profile': ok(newProfile),
  'GET /portal/organisations': organisationList(),
});

describe('a form anyone can answer, in the portal', () => {
  it('reads the form and starts the check without reading a session or sending a cookie', async () => {
    const sent = stubApi({
      [`GET /public/tenants/northfield/forms/${FORM_ID}`]: { status: 200, body: publicForm() },
      [`GET /public/tenants/northfield/forms/${FORM_ID}/challenge`]: {
        status: 200,
        body: challengeReply(),
      },
    });

    openPortal(`/northfield/forms/${FORM_ID}`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Funder A feedback' }),
    ).toBeTruthy();
    expect(sent.some(({ key }) => key.includes('/auth/'))).toBe(false);
    const calls = vi.mocked(fetch).mock.calls as [string, RequestInit][];
    const forForm = calls.filter(([url]) => url.includes('/forms/'));
    expect(forForm).toHaveLength(2);
    expect(forForm.every(([, init]) => init.credentials === 'omit')).toBe(true);
  });

  it('shows the not-found page for a form the API will not show', async () => {
    stubApi({
      [`GET /public/tenants/northfield/forms/${FORM_ID}`]: {
        status: 404,
        body: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: 'Not found.',
          requestId: 'req_test',
        },
      },
    });

    openPortal(`/northfield/forms/${FORM_ID}`);

    expect(await screen.findByRole('heading', { name: 'We cannot find this form' })).toBeTruthy();
  });
});

describe('the forms section of the front door', () => {
  it('appears when forms is on, and opens the answers the person has sent', async () => {
    stubApi({
      ...signedIn({ modules: ['forms'] }),
      'GET /portal/form-responses': {
        status: 200,
        body: myResponsePageSchema.parse({
          responses: [
            {
              id: RESPONSE_ID,
              formId: FORM_ID,
              formTitle: 'Funder A survey',
              submittedAt: '2027-01-05T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
      },
    });
    openPortal('/northfield/');

    const list = (await screen.findAllByRole('list')).find((item) =>
      within(item).queryByRole('link', { name: 'Your forms' }),
    ) as HTMLElement;
    expect(within(list).getByText('Read the forms you have answered.')).toBeTruthy();

    window.history.pushState(null, '', '/northfield/form-responses');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('link', { name: 'Funder A survey' })).toBeTruthy();
  });

  it('is left out, and its addresses are not found, when forms is off', async () => {
    stubApi(signedIn({ modules: [] }));
    openPortal('/northfield/');

    await screen.findByRole('link', { name: 'Your details and organisations' });
    expect(screen.queryByRole('link', { name: 'Your forms' })).toBeNull();

    window.history.pushState(null, '', '/northfield/form-responses');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });

  it('shows page not found, as for any address, when forms says it is not there', async () => {
    stubApi({
      ...signedIn({ modules: ['forms'] }),
      [`GET /portal/forms/${FORM_ID}`]: {
        status: 404,
        body: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: 'Not found.',
          requestId: 'req_test',
        },
      },
      [`GET /portal/forms/${FORM_ID}/draft`]: {
        status: 404,
        body: {
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          detail: 'Not found.',
          requestId: 'req_test',
        },
      },
    });

    openPortal(`/northfield/your-forms/${FORM_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});
