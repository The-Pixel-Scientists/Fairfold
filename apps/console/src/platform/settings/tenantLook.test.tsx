// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { problem, stubApi } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, heading, ok, publicTenant } from './testing.ts';

setUpConsoleTests();

const PUBLIC = 'GET /public/tenants/northfield';
const stylesheet = () => document.head.querySelector('link[rel="stylesheet"]');

afterEach(() => {
  for (const link of document.head.querySelectorAll('link')) link.remove();
});

describe("the funder's look in the console", () => {
  it("applies the funder's stylesheet and preset to every page, signed in or not", async () => {
    stubApi({
      'GET /auth/session': problem(401, 'You are not signed in.'),
      [PUBLIC]: ok(publicTenant({ preset: 'rounded', brandColour: '#0b5d3b' })),
    });
    openConsole('/northfield/sign-in');
    await heading('Sign in');

    await waitFor(() => {
      expect(stylesheet()?.getAttribute('href')).toBe('/api/public/tenants/northfield/theme.css');
    });
    expect(document.documentElement.dataset['preset']).toBe('rounded');
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('keeps the standard look for a funder the API does not know, and shows no error', async () => {
    stubApi({
      'GET /auth/session': problem(401, 'You are not signed in.'),
      [PUBLIC]: problem(404, 'Not found.'),
    });
    openConsole('/northfield/sign-in');
    await heading('Sign in');

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(stylesheet()).toBeNull();
    expect(document.documentElement.dataset['preset']).toBeUndefined();
  });

  it('shows the logo in the header with the funder name as its alternative text', async () => {
    stubApi({ [SESSION]: ok(administrator()), [PUBLIC]: ok(publicTenant({ hasLogo: true })) });
    openConsole('/northfield/settings/modules');
    await heading('Modules');

    const logo = await within(screen.getByRole('banner')).findByRole('img', {
      name: 'Northfield Foundation',
    });
    expect(logo.getAttribute('src')).toBe('/api/public/tenants/northfield/logo');
  });

  it('shows the name alone in the header when there is no logo', async () => {
    stubApi({ [SESSION]: ok(administrator()) });
    openConsole('/northfield/settings/modules');
    await heading('Modules');

    expect(within(screen.getByRole('banner')).getByText('Northfield Foundation')).toBeTruthy();
    expect(within(screen.getByRole('banner')).queryByRole('img')).toBeNull();
  });
});
