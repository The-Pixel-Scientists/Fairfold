// SPDX-License-Identifier: AGPL-3.0-or-later

import { moduleIds, switchableModuleIds } from '@pixel-scientists/domain/platform';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { consoleModules } from '../modules.ts';
import { consoleSession, stubApi } from '../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../testing/render.tsx';
import { moduleItem, visibleItems } from './navigation.ts';

const crmPage = vi.hoisted(() => ({ loaded: vi.fn(), listsLoaded: vi.fn() }));
// The console reads the tool's routes as it starts; its landing page is the
// code that must wait until someone opens the section.
vi.mock('@pixel-scientists/crm/console', () => ({
  crmConsoleRoutes: [
    {
      path: '/crm/lists',
      title: 'Lists',
      load: () => {
        crmPage.listsLoaded();
        return Promise.resolve({ default: () => <h1>CRM lists</h1> });
      },
    },
  ],
  default: lazy(() => {
    crmPage.loaded();
    return Promise.resolve({ default: () => <h1>CRM records</h1> });
  }),
}));

setUpConsoleTests();

const crm = moduleItem({ id: 'crm', path: '/crm' });
const labels = (items: readonly { label: string }[]) => items.map(({ label }) => label);

describe('the module registry', () => {
  it('has an entry for every switchable module, and only for modules that exist', () => {
    expect(consoleModules.map(({ id }) => id)).toEqual(switchableModuleIds);
    for (const { id } of consoleModules) expect(moduleIds).toContain(id);
  });
});

describe('visibleItems for a tool', () => {
  const allow = ['crm.records.read'];

  it('shows a tool that is on and permitted', () => {
    expect(labels(visibleItems({ permissions: allow, modules: ['crm'] }, [crm]))).toEqual(['CRM']);
  });

  it('hides a tool that is on but not permitted', () => {
    expect(visibleItems({ permissions: ['assure.lookup.read'], modules: ['crm'] }, [crm])).toEqual(
      [],
    );
  });

  it('hides a tool that is off, or missing from the list, however permitted', () => {
    expect(visibleItems({ permissions: allow, modules: ['forms'] }, [crm])).toEqual([]);
    expect(visibleItems({ permissions: allow, modules: [] }, [crm])).toEqual([]);
    expect(visibleItems({ permissions: allow }, [crm])).toEqual([]);
  });

  it('shows nothing without an active membership', () => {
    expect(visibleItems({ permissions: [], modules: [] })).toEqual([]);
  });

  it('hides grants when the session lists modules without it', () => {
    const permissions = ['grants.programmes.manage'];
    expect(labels(visibleItems({ permissions, modules: ['grants'] }))).toEqual(['Programmes']);
    expect(visibleItems({ permissions, modules: ['crm'] })).toEqual([]);
    expect(visibleItems({ permissions })).toEqual([]);
  });
});

describe('a tool in the console', () => {
  const member = (modules: string[], permissions: string[]) => ({
    'GET /auth/session': {
      status: 200,
      body: { ...consoleSession(), modules, permissions },
    },
  });

  it('is listed after grants and fetches its code only when opened', async () => {
    const user = userEvent.setup();
    stubApi(member(['grants', 'crm'], ['grants.programmes.manage', 'crm.records.read']));
    openConsole('/northfield/');

    const navigation = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Programmes', 'CRM']);
    expect(crmPage.loaded).not.toHaveBeenCalled();

    await user.click(within(navigation).getByRole('link', { name: 'CRM' }));

    await screen.findByRole('heading', { level: 1, name: 'CRM records' });
    expect(crmPage.loaded).toHaveBeenCalledOnce();
    const current = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
      name: 'CRM',
    });
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('shows the not-found page, and does not fetch its code, when the tool is off', async () => {
    crmPage.loaded.mockClear();
    stubApi(member(['grants'], ['grants.programmes.manage', 'crm.records.read']));
    openConsole('/northfield/crm');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expectTitle('Page not found – Fairfold Grants console');
    expect(crmPage.loaded).not.toHaveBeenCalled();
  });

  it('shows the not-found page when the member holds none of the tool permissions', async () => {
    stubApi(member(['grants', 'crm'], ['grants.programmes.manage']));
    openConsole('/northfield/crm');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  });

  it('opens a page under the tool when the tool is on and permitted', async () => {
    stubApi(member(['grants', 'crm'], ['grants.programmes.manage', 'crm.records.read']));
    openConsole('/northfield/crm/lists');

    await screen.findByRole('heading', { level: 1, name: 'CRM lists' });
    await expectTitle('Lists – Fairfold Grants console');
  });

  it('shows the not-found page for a page under the tool, and does not fetch it, when the tool is off', async () => {
    crmPage.listsLoaded.mockClear();
    stubApi(member(['grants'], ['grants.programmes.manage', 'crm.records.read']));
    openConsole('/northfield/crm/lists');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    await expectTitle('Page not found – Fairfold Grants console');
    expect(crmPage.listsLoaded).not.toHaveBeenCalled();
  });

  it('shows the not-found page for a page under the tool to a member without its permissions', async () => {
    stubApi(member(['grants', 'crm'], ['grants.programmes.manage']));
    openConsole('/northfield/crm/lists');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  });
});
