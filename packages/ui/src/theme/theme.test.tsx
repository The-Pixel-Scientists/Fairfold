// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantLogo } from './TenantLogo.tsx';
import { TenantTheme, refreshTenantAssets, tenantAsset } from './TenantTheme.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stylesheets = () => document.head.querySelectorAll('link[rel="stylesheet"]');

describe('TenantTheme', () => {
  it("adds the funder's stylesheet from the same origin, with no inline style, and sets the preset", () => {
    render(<TenantTheme slug="northfield" preset="rounded" />);

    expect(stylesheets()).toHaveLength(1);
    expect(stylesheets()[0]?.getAttribute('href')).toBe('/api/public/tenants/northfield/theme.css');
    expect(document.documentElement.dataset['preset']).toBe('rounded');
    expect(document.head.querySelector('style')).toBeNull();
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('follows a change of preset, and takes both away when it goes', () => {
    const { rerender, unmount } = render(<TenantTheme slug="northfield" preset="rounded" />);

    rerender(<TenantTheme slug="northfield" preset="square" />);
    expect(document.documentElement.dataset['preset']).toBe('square');
    expect(stylesheets()).toHaveLength(1);

    unmount();
    expect(stylesheets()).toHaveLength(0);
    expect(document.documentElement.dataset['preset']).toBeUndefined();
  });

  it('keeps a slug to one path segment, whatever it holds', () => {
    expect(tenantAsset('a/../b?c', 'logo')).toBe('/api/public/tenants/a%2F..%2Fb%3Fc/logo');
  });

  it('adds the new stylesheet once the version changes, and drops the old one only once the new one is in', () => {
    const { rerender } = render(<TenantTheme slug="northfield" preset="standard" version={0} />);
    const old = stylesheets()[0];

    rerender(<TenantTheme slug="northfield" preset="standard" version={1} />);

    expect(stylesheets()).toHaveLength(2);
    expect(stylesheets()[0]).toBe(old);
    stylesheets()[1]?.dispatchEvent(new Event('load'));
    expect(stylesheets()).toHaveLength(1);
    expect(stylesheets()[0]).not.toBe(old);
  });

  it('keeps the old stylesheet if the new one does not load', () => {
    const { rerender } = render(<TenantTheme slug="northfield" preset="standard" />);

    rerender(<TenantTheme slug="northfield" preset="standard" version={1} />);
    stylesheets()[1]?.dispatchEvent(new Event('error'));

    expect(stylesheets()).toHaveLength(2);
  });

  it('takes every stylesheet away when it goes, even one still waiting to load', () => {
    const { rerender, unmount } = render(<TenantTheme slug="northfield" preset="standard" />);
    rerender(<TenantTheme slug="northfield" preset="standard" version={1} />);
    expect(stylesheets()).toHaveLength(2);

    unmount();

    expect(stylesheets()).toHaveLength(0);
  });
});

describe('refreshTenantAssets', () => {
  it('reads the stylesheet and the logo again, past the cache', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('')));
    vi.stubGlobal('fetch', fetch);

    await refreshTenantAssets('northfield');

    expect(fetch.mock.calls).toEqual([
      ['/api/public/tenants/northfield/theme.css', { cache: 'reload', credentials: 'same-origin' }],
      ['/api/public/tenants/northfield/logo', { cache: 'reload', credentials: 'same-origin' }],
    ]);
  });

  it('carries on when a read fails, since the old look still works', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    await expect(refreshTenantAssets('northfield')).resolves.toBeUndefined();
  });
});

describe('TenantLogo', () => {
  it("shows the logo with the funder's name as its alternative text", () => {
    render(<TenantLogo slug="northfield" name="Northfield Foundation" hasLogo />);

    const logo = screen.getByRole('img', { name: 'Northfield Foundation' });
    expect(logo.getAttribute('src')).toBe('/api/public/tenants/northfield/logo');
  });

  it('draws the image afresh when the version changes', () => {
    const { rerender } = render(
      <TenantLogo slug="northfield" name="Northfield Foundation" hasLogo />,
    );
    const before = screen.getByRole('img');

    rerender(<TenantLogo slug="northfield" name="Northfield Foundation" hasLogo version={1} />);

    expect(screen.getByRole('img')).not.toBe(before);
  });

  it('shows the name alone when the funder has no logo', () => {
    render(<TenantLogo slug="northfield" name="Northfield Foundation" hasLogo={false} />);

    expect(screen.getByText('Northfield Foundation')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
