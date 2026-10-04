// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Link, Router } from './index.ts';
import type { PageModule, RouteDefinition } from './index.ts';
import {
  Application,
  Home,
  activeHeading,
  announcement,
  onCleanup,
  renderRouter,
  routes,
  scrollTo,
  setUpRouterTests,
} from '../../test/routerTesting.tsx';

setUpRouterTests();

describe('Router: first page load', () => {
  it('shows the matching page and sets the document title', () => {
    renderRouter('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(document.title).toBe('Programmes – Fairfold Grants console');
  });

  it('keeps the browser focus, does not scroll and announces nothing', () => {
    renderRouter('/');
    expect(document.activeElement).toBe(document.body);
    expect(scrollTo()).not.toHaveBeenCalled();
    expect(announcement()).toBe('');
  });

  it('reads parameters and builds the title from them', () => {
    renderRouter('/applications/42');
    expect(screen.getByRole('heading', { level: 1, name: 'Application 42' })).toBeTruthy();
    expect(document.title).toBe('Application 42 – Fairfold Grants console');
  });

  it('uses the title alone when there is no suffix', () => {
    renderRouter('/', <Router routes={routes} />);
    expect(document.title).toBe('Programmes');
  });

  it('shows a loading state while a lazily loaded page loads', async () => {
    let finish: (module: PageModule) => void = () => undefined;
    const slow: RouteDefinition[] = [
      {
        path: '/',
        title: 'Slow page',
        load: () =>
          new Promise<PageModule>((resolve) => {
            finish = resolve;
          }),
      },
    ];
    renderRouter('/', <Router routes={slow} />);
    expect(screen.getByText('Loading page…')).toBeTruthy();
    finish({ default: Home });
    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    // The first load never moves focus, even after a lazy page arrives.
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Router: moving to another page', () => {
  it('moves focus to the new h1, updates the title, scrolls to the top and announces', async () => {
    const user = userEvent.setup();
    renderRouter('/');

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(window.location.pathname).toBe('/applications/42');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.title).toBe('Application 42 – Fairfold Grants console');
    expect(scrollTo()).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(announcement()).toBe('Navigated to Application 42');
  });

  it('works from the keyboard: Tab to a link and press Enter', async () => {
    const user = userEvent.setup();
    renderRouter('/');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open application 42' }));
    await user.keyboard('{Enter}');

    const heading = await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(document.activeElement).toBe(heading);
    expect(window.location.pathname).toBe('/applications/42');
    expect(announcement()).toBe('Navigated to Application 42');
  });

  it('scrolls instantly when the person prefers reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query.includes('prefers-reduced-motion: reduce') }),
    });
    onCleanup(() => {
      Reflect.deleteProperty(window, 'matchMedia');
    });
    const user = userEvent.setup();
    renderRouter('/');

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(scrollTo()).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('shows the not-found page for an unknown path, with the same behaviour', async () => {
    const user = userEvent.setup();
    renderRouter('/');

    await user.click(screen.getByRole('link', { name: 'Open a missing page' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe('Page not found – Fairfold Grants console');
    expect(announcement()).toBe('Navigated to Page not found');
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeTruthy();
  });

  it('shows the not-found page when the first address matches nothing', () => {
    renderRouter('/nothing/here');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(document.title).toBe('Page not found – Fairfold Grants console');
    expect(document.activeElement).toBe(document.body);
  });

  it('lets an app supply its own not-found page', () => {
    renderRouter(
      '/nothing/here',
      <Router
        routes={routes}
        notFound={{ title: 'No such page', component: () => <h1>Nothing here</h1> }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing here' })).toBeTruthy();
    expect(document.title).toBe('No such page');
  });

  it('gives a plain h1 a tabindex of -1 before focusing it', async () => {
    const plain: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      { path: '/applications/:id', title: 'Application', component: () => <h1>Plain heading</h1> },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={plain} />);

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Plain heading' });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('focuses the page itself when a page has no h1', async () => {
    const headless: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      {
        path: '/applications/:id',
        title: 'Application',
        component: () => <p>No heading here</p>,
      },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={headless} />);

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    const text = await screen.findByText('No heading here');
    await waitFor(() => {
      expect(document.activeElement?.contains(text)).toBe(true);
    });
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });

  it('announces a second visit to a page with the same title', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    const first = document.querySelector('[aria-live="polite"] span');

    await user.click(screen.getByRole('link', { name: 'Back to programmes' }));
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });

    expect(announcement()).toBe('Navigated to Application 42');
    // A new element each time, so assistive technology reads it again.
    expect(document.querySelector('[aria-live="polite"] span')).not.toBe(first);
  });

  it('marks the link to the current page with aria-current', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    expect(screen.getByRole('link', { name: 'Programmes home' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Open application 42' }).getAttribute('aria-current'),
    ).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(
      screen.getByRole('link', { name: 'Back to programmes' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('keeps the old page and its focus until a lazily loaded page arrives', async () => {
    let finish: (module: PageModule) => void = () => undefined;
    const lazyRoutes: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      {
        path: '/applications/:id',
        title: 'Application 42',
        load: () =>
          new Promise<PageModule>((resolve) => {
            finish = resolve;
          }),
      },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={lazyRoutes} />);

    const link = screen.getByRole('link', { name: 'Open application 42' });
    await user.click(link);

    expect(screen.getByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(document.activeElement).toBe(link);
    expect(document.title).toBe('Programmes');
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    finish({ default: Application });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe('Application 42');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows an error page, with focus on its heading, when a page fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      {
        path: '/applications/:id',
        title: 'Application',
        load: () => Promise.reject(new Error('Failed to fetch module')),
      },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={failing} />);

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'This page did not load',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(document.title).toBe('This page did not load');
    expect(announcement()).toBe('This page did not load');

    window.history.back();
    expect(await screen.findByRole('heading', { level: 1, name: 'Programmes' })).toBeTruthy();
    expect(document.title).toBe('Programmes');
  });

  it('retries a page that failed to load the next time the person goes there', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<PageModule>>()
      .mockRejectedValueOnce(new Error('Failed to fetch module'))
      .mockResolvedValue({ default: Application });
    const flaky: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      { path: '/applications/:id', title: 'Application', load },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={flaky} />);

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'This page did not load' });
    window.history.back();
    await screen.findByRole('heading', { level: 1, name: 'Programmes' });
    await user.click(screen.getByRole('link', { name: 'Open application 42' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Application 42' })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep retrying a page that keeps failing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<PageModule>>().mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    renderRouter(
      '/',
      <Router
        routes={[
          { path: '/', title: 'Programmes', component: Home },
          { path: '/applications/:id', title: 'Application', load },
        ]}
      />,
    );

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'This page did not load' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('treats an error page on the first load as a change of page: title, announcement, focus', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: RouteDefinition[] = [
      {
        path: '/',
        title: 'Programmes',
        load: () => Promise.reject(new Error('Failed to fetch module')),
      },
    ];
    renderRouter('/', <Router routes={broken} titleSuffix="Fairfold Grants console" />);

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'This page did not load',
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe('This page did not load – Fairfold Grants console');
    expect(announcement()).toBe('This page did not load');
  });

  it('shows the error page you give it, so other readers get their own words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: RouteDefinition[] = [
      { path: '/', title: 'Programmes', load: () => Promise.reject(new Error('Failed')) },
    ];
    renderRouter(
      '/',
      <Router
        routes={broken}
        errorPage={{
          title: 'We could not open this page',
          component: () => <h1>We could not open this page</h1>,
        }}
      />,
    );

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'We could not open this page',
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe('We could not open this page');
    expect(screen.queryByText(/administrator/)).toBeNull();
  });

  it('shows and announces "Loading" once a page has been slow for a moment', async () => {
    let finish: (module: PageModule) => void = () => undefined;
    const slow: RouteDefinition[] = [
      { path: '/', title: 'Programmes', component: Home },
      {
        path: '/applications/:id',
        title: 'Application 42',
        load: () =>
          new Promise<PageModule>((resolve) => {
            finish = resolve;
          }),
      },
    ];
    const user = userEvent.setup();
    renderRouter('/', <Router routes={slow} />);

    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    expect(announcement()).toBe('');

    // One visible line, and one announcement through the region that is always on the page.
    await waitFor(() => {
      expect(announcement()).toBe('Loading Application 42…');
    });
    expect(screen.getAllByText('Loading Application 42…')).toHaveLength(2);

    finish({ default: Application });
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    await waitFor(() => {
      expect(announcement()).toBe('Navigated to Application 42');
    });
    expect(screen.queryByText('Loading Application 42…')).toBeNull();
  });
});

describe('Router: back and forward', () => {
  it('shows the right page and moves focus to its heading', async () => {
    const user = userEvent.setup();
    renderRouter('/');
    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });

    window.history.back();
    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
    expect(window.location.pathname).toBe('/');
    expect(document.title).toBe('Programmes – Fairfold Grants console');
    expect(announcement()).toBe('Navigated to Programmes');

    window.history.forward();
    await waitFor(() => {
      expect(activeHeading()).toBe('Application 42');
    });
    expect(document.title).toBe('Application 42 – Fairfold Grants console');
  });

  it('puts the person back where they were scrolled, and takes focus without scrolling', async () => {
    let scrollY = 0;
    const original = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    onCleanup(() => {
      if (original) Object.defineProperty(window, 'scrollY', original);
    });
    const user = userEvent.setup();
    renderRouter('/');
    expect(window.history.scrollRestoration).toBe('manual');

    scrollY = 300;
    await user.click(screen.getByRole('link', { name: 'Open application 42' }));
    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(scrollTo()).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' });

    scrollY = 40;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    window.history.back();
    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
    expect(scrollTo()).toHaveBeenLastCalledWith({ top: 300, left: 0, behavior: 'auto' });
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });

    window.history.forward();
    await waitFor(() => {
      expect(activeHeading()).toBe('Application 42');
    });
    expect(scrollTo()).toHaveBeenLastCalledWith({ top: 40, left: 0, behavior: 'auto' });
  });
});

describe('Router: search string and hash', () => {
  it('parses the search string through a schema', async () => {
    const user = userEvent.setup();
    renderRouter('/filters');
    expect(screen.getByTestId('filters').textContent).toBe('{"success":true,"data":{}}');

    await user.click(screen.getByRole('button', { name: 'Filter by review' }));

    await waitFor(() => {
      expect(screen.getByTestId('filters').textContent).toBe(
        '{"success":true,"data":{"stage":"review","owner":["a","b"]}}',
      );
    });
  });

  it('gives the schema failure to the page when the address is not valid', () => {
    renderRouter('/filters?unknown=1');
    expect(screen.getByTestId('filters').textContent).toBe(
      '{"success":false,"error":"Unknown filter"}',
    );
  });

  it('keeps focus where it is when only the search string changes', async () => {
    const user = userEvent.setup();
    renderRouter('/filters');
    const button = screen.getByRole('button', { name: 'Filter by review' });

    await user.click(button);
    await waitFor(() => {
      expect(window.location.search).toBe('?stage=review&owner=a&owner=b');
    });

    expect(document.activeElement).toBe(button);
    expect(scrollTo()).not.toHaveBeenCalled();
    expect(announcement()).toBe('');
  });

  it('keeps focus where it is when only the hash changes', async () => {
    const user = userEvent.setup();
    renderRouter('/filters');
    const button = screen.getByRole('button', { name: 'Jump to history' });

    await user.click(button);
    await waitFor(() => {
      expect(window.location.hash).toBe('#history');
    });

    expect(document.activeElement).toBe(button);
    expect(announcement()).toBe('');
  });
});

describe('Router: base path', () => {
  function renderWithBase(path: string) {
    return renderRouter(
      path,
      <Router routes={routes} basePath="/console/" titleSuffix="Fairfold Grants" />,
    );
  }

  it('matches routes after the base path and puts it in every link', async () => {
    const user = userEvent.setup();
    renderWithBase('/console/');
    const link = screen.getByRole('link', { name: 'Open application 42' });
    expect(link.getAttribute('href')).toBe('/console/applications/42');

    await user.click(link);

    await screen.findByRole('heading', { level: 1, name: 'Application 42' });
    expect(window.location.pathname).toBe('/console/applications/42');
  });

  it('treats an address outside the base path as not found', () => {
    renderWithBase('/other/');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});

describe('Router: layout', () => {
  function Frame({ children }: { children: ReactNode }) {
    return (
      <div>
        <nav aria-label="Main">
          <Link to="/">Programmes home</Link>
        </nav>
        <main>{children}</main>
      </div>
    );
  }

  it('wraps the page, and links in the frame work', async () => {
    const user = userEvent.setup();
    renderRouter('/applications/42', <Router routes={routes} layout={Frame} />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Programmes home' }));

    await waitFor(() => {
      expect(activeHeading()).toBe('Programmes');
    });
  });
});

describe('hooks outside a Router', () => {
  it('say so, rather than failing quietly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Link to="/">Home</Link>)).toThrow('Link must be used inside a Router.');
  });
});
