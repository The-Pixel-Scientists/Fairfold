// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { productName } from '../product.ts';
import { applicantSession, stubApi } from '../testing/api.ts';
import { applicationList } from '../testing/apply.ts';
import { expectTitle, openPortal, setUpPortalTests } from '../testing/render.tsx';
import { organisationList, ok, newProfile } from '../testing/party.ts';
import { grantsModule } from './modules.ts';

setUpPortalTests();

const signedIn = (modules: Parameters<typeof applicantSession>[0] = {}) => ({
  'GET /auth/session': { status: 200, body: applicantSession(modules) },
  'GET /portal/profile': ok(newProfile),
  'GET /portal/organisations': organisationList(),
});

describe('the front door', () => {
  it('lists a section for each tool the person may use', async () => {
    stubApi(signedIn());
    openPortal('/northfield/');

    const list = (await screen.findAllByRole('list')).find((item) =>
      within(item).queryByRole('link', { name: 'Grants' }),
    ) as HTMLElement;
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Your details and organisations', 'Grants']);
    expect(within(list).getByText('Start or continue an application.')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('still lists the one section when grants is off', async () => {
    stubApi(signedIn({ modules: [] }));
    openPortal('/northfield/');

    await screen.findByRole('link', { name: 'Your details and organisations' });
    expect(screen.queryByRole('link', { name: 'Grants' })).toBeNull();
  });

  it('shows the not-found page for a tool that is off', async () => {
    stubApi(signedIn({ modules: [] }));
    openPortal('/northfield/programmes');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.queryByText('Programmes you can apply to')).toBeNull();
  });

  it('titles a tool that is off as not found, not by the tool', async () => {
    stubApi(signedIn({ modules: [] }));
    openPortal('/northfield/applications');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    await expectTitle(`Page not found – ${productName}`);
  });

  it('announces a tool that is off as not found when the person moves to it', async () => {
    stubApi(signedIn({ modules: [] }));
    openPortal('/northfield/');
    await screen.findByRole('link', { name: 'Your details and organisations' });

    act(() => {
      window.history.pushState(null, '', '/northfield/applications');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(screen.getByRole('status').textContent).toBe('Navigated to Page not found');
    await expectTitle(`Page not found – ${productName}`);
  });
});

describe('a tool in the portal', () => {
  it('fetches its code only when one of its pages is opened', async () => {
    const load = vi.spyOn(grantsModule, 'load').mockResolvedValue({});
    stubApi({ ...signedIn(), 'GET /portal/applications': applicationList() });
    openPortal('/northfield/');
    await screen.findByRole('link', { name: 'Grants' });
    expect(load).not.toHaveBeenCalled();

    cleanup();
    openPortal('/northfield/applications');
    await screen.findByRole('heading', { level: 1, name: 'Your applications' });
    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
    load.mockRestore();
  });
});
