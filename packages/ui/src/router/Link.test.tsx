// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InvalidAppPathError, Link, Router, useNavigate } from './index.ts';
import {
  renderRouter,
  routes,
  scrollTo,
  setUpRouterTests,
  watchClicks,
} from '../../test/routerTesting.tsx';

setUpRouterTests();

describe('Router: links', () => {
  it('renders a real link with an href', () => {
    renderRouter('/');
    const link = screen.getByRole('link', { name: 'Open application 42' });
    expect(link.getAttribute('href')).toBe('/applications/42');
  });

  it('leaves modifier clicks, other buttons and new-tab links to the browser', () => {
    const clicks = watchClicks();
    renderRouter('/');
    const link = screen.getByRole('link', { name: 'Open application 42' });

    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { altKey: true });
    fireEvent.click(link, { button: 1 });

    expect(clicks.defaultPrevented).toEqual([false, false, false, false, false]);
    expect(window.location.pathname).toBe('/');
    expect(document.activeElement).toBe(document.body);
    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it('leaves a link that opens elsewhere, or downloads, to the browser', () => {
    const clicks = watchClicks();
    renderRouter(
      '/',
      <Router
        routes={[
          {
            path: '/',
            title: 'Programmes',
            component: () => (
              <>
                <h1>Programmes</h1>
                <Link to="/export" target="_blank" rel="noreferrer">
                  Open export in a new tab
                </Link>
                <Link to="/export.csv" download>
                  Download export
                </Link>
              </>
            ),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Open export in a new tab' }));
    fireEvent.click(screen.getByRole('link', { name: 'Download export' }));

    expect(clicks.defaultPrevented).toEqual([false, false]);
    expect(window.location.pathname).toBe('/');
  });

  it('handles a plain left click itself', () => {
    const clicks = watchClicks();
    renderRouter('/');
    fireEvent.click(screen.getByRole('link', { name: 'Open application 42' }));
    expect(clicks.defaultPrevented).toEqual([true]);
  });

  it('refuses a link outside the app: it throws when it renders', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Frame() {
      return <Link to="//evil.example">Elsewhere</Link>;
    }
    expect(() => renderRouter('/', <Router routes={routes} layout={Frame} />)).toThrow(
      InvalidAppPathError,
    );
  });

  it('refuses a link that climbs out of the base path', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Frame() {
      return <Link to="/../portal">Portal</Link>;
    }
    expect(() =>
      renderRouter('/console/', <Router routes={routes} basePath="/console" layout={Frame} />),
    ).toThrow(InvalidAppPathError);
  });

  it('shows the error page, not a broken app, when a page holds a link outside the app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderRouter(
      '/',
      <Router
        routes={[
          {
            path: '/',
            title: 'Home',
            component: () => <Link to="//evil.example">Elsewhere</Link>,
          },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'This page did not load' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Elsewhere' })).toBeNull();
  });

  it('refuses a navigation outside the app and leaves the address alone', async () => {
    const crafted = [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/\t/evil.example',
      '/..//evil.example',
      '/.//evil.example',
      '/%2e%2e//evil.example',
      '/a/..//evil.example',
    ];
    const refused: unknown[] = [];
    function Capture() {
      const navigate = useNavigate();
      return (
        <>
          <h1>Capture</h1>
          <button
            type="button"
            onClick={() => {
              for (const to of crafted) {
                try {
                  navigate(to);
                } catch (error) {
                  refused.push(error);
                }
              }
            }}
          >
            Try crafted paths
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    renderRouter('/', <Router routes={[{ path: '/', title: 'Capture', component: Capture }]} />);
    const pushState = vi.spyOn(window.history, 'pushState');

    await user.click(screen.getByRole('button', { name: 'Try crafted paths' }));

    expect(refused).toHaveLength(crafted.length);
    for (const error of refused) expect(error).toBeInstanceOf(InvalidAppPathError);
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('replaces the history entry when a link points at the page you are already on', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    const before = window.history.length;

    await user.click(screen.getByRole('link', { name: 'Programmes home' }));

    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/');
  });

  it('marks a section link while a page in it is open, and only then', () => {
    function Page() {
      return (
        <>
          <Link to="/settings" section>
            Settings section
          </Link>
          <Link to="/settings">Settings page</Link>
          <Link to="/set" section>
            Set section
          </Link>
          <Link to="/settings/look" section>
            Look section
          </Link>
        </>
      );
    }
    window.history.replaceState(null, '', '/settings/look');
    render(<Router routes={[{ path: '/settings/look', title: 'Look', component: Page }]} />);

    const current = (name: string) =>
      screen.getByRole('link', { name }).getAttribute('aria-current');
    expect(current('Settings section')).toBe('true');
    expect(current('Settings page')).toBeNull();
    expect(current('Set section')).toBeNull();
    expect(current('Look section')).toBe('page');
  });
});
