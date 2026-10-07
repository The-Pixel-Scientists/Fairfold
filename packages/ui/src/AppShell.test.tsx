// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.tsx';
import { EmptyState } from './EmptyState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { Router } from './router/index.ts';

const navigation = (
  <ul>
    <li>
      <a href="/programmes">Programmes</a>
    </li>
    <li>
      <a href="/reviews">Reviews</a>
    </li>
  </ul>
);

describe('AppShell', () => {
  it('has a banner, a named navigation and a main landmark', () => {
    render(
      <AppShell productName="Fairfold Grants" areaName="Staff console" navigation={navigation}>
        <h1>Programmes</h1>
      </AppShell>,
    );

    expect(screen.getByRole('banner').textContent).toContain('Fairfold Grants');
    expect(screen.getByRole('banner').textContent).toContain('Staff console');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.id).toBe('main-content');
    expect(main.contains(screen.getByRole('heading', { level: 1, name: 'Programmes' }))).toBe(true);
  });

  it('has a footer landmark, after the page, with the Appearance group in it', () => {
    render(
      <AppShell productName="Fairfold Grants" navigation={navigation}>
        <h1>Programmes</h1>
      </AppShell>,
    );

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('group', { name: 'Appearance' })).toBeTruthy();
    expect(within(footer).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    // Not inside the main landmark or the header, and after the page in reading order.
    expect(screen.getByRole('main').contains(footer)).toBe(false);
    expect(screen.getByRole('banner').contains(footer)).toBe(false);
    expect(
      screen.getByRole('main').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole('group', { name: 'Appearance' })).toHaveLength(1);
  });

  it('has the footer without navigation too', () => {
    render(
      <AppShell productName="Fairfold Grants">
        <h1>Programmes</h1>
      </AppShell>,
    );

    expect(
      within(screen.getByRole('contentinfo')).getByRole('group', { name: 'Appearance' }),
    ).toBeTruthy();
  });

  it('adds nothing to the banner from the product mark', () => {
    render(
      <AppShell productName="Fairfold Grants" areaName="Staff console">
        <h1>Programmes</h1>
      </AppShell>,
    );

    const banner = screen.getByRole('banner');
    const mark = banner.querySelector('svg');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.querySelector('title, desc')).toBeNull();
    expect(mark?.hasAttribute('aria-label')).toBe(false);
    expect(mark?.hasAttribute('aria-labelledby')).toBe(false);
    expect(mark?.textContent).toBe('');
    expect(within(banner).queryAllByRole('img')).toEqual([]);
    expect(banner.textContent).toBe('Fairfold GrantsStaff console');
  });

  it('names the home link by the product name alone, without the mark', () => {
    function Frame({ children }: { children: ReactNode }) {
      return (
        <AppShell productName="Fairfold Grants" homeHref="/">
          {children}
        </AppShell>
      );
    }
    window.history.replaceState(null, '', '/');
    render(
      <Router
        routes={[{ path: '/', title: 'Home', component: () => <h1>Home</h1> }]}
        layout={Frame}
      />,
    );

    const link = within(screen.getByRole('banner')).getByRole('link');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: 'Fairfold Grants' })).toBe(link);
  });

  it('makes the product name a link to the home path, through the router, when asked', () => {
    function Frame({ children }: { children: ReactNode }) {
      return (
        <AppShell productName="Fairfold Grants" homeHref="/">
          {children}
        </AppShell>
      );
    }
    window.history.replaceState(null, '', '/portal/about');
    render(
      <Router
        routes={[{ path: '/about', title: 'About', component: () => <h1>About</h1> }]}
        basePath="/portal"
        layout={Frame}
      />,
    );

    const link = screen.getByRole('link', { name: 'Fairfold Grants' });
    expect(link.getAttribute('href')).toBe('/portal/');
    // As tall as a control (44px comfortable, 32px compact), not just a line of text.
    expect(link.className).toContain('inline-flex');
    expect(link.className).toContain('min-h-control');
    window.history.replaceState(null, '', '/');
  });

  it('shows the product name as plain text without homeHref', () => {
    render(
      <AppShell productName="Fairfold Grants">
        <h1>Programmes</h1>
      </AppShell>,
    );
    expect(screen.queryByRole('link', { name: 'Fairfold Grants' })).toBeNull();
  });

  it('names the navigation what you say', () => {
    render(
      <AppShell productName="Fairfold Grants" navigation={navigation} navigationLabel="Programme">
        <h1>Programmes</h1>
      </AppShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Programme' })).toBeTruthy();
  });

  it('has no navigation landmark when there is no navigation', () => {
    render(
      <AppShell productName="Fairfold Grants">
        <h1>Programmes</h1>
      </AppShell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('puts the skip link first, and it jumps past the navigation to the page', async () => {
    const user = userEvent.setup();
    render(
      <AppShell productName="Fairfold Grants" navigation={navigation}>
        <h1>Programmes</h1>
        <a href="/inside">Inside the page</a>
      </AppShell>,
    );

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Inside the page' }));
  });

  it('tabs through the header actions and the navigation in reading order', async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        productName="Fairfold Grants"
        navigation={navigation}
        actions={<button type="button">Open account menu</button>}
      >
        <h1>Programmes</h1>
      </AppShell>,
    );

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open account menu' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Programmes' }));
  });

  it('sets the density for everything inside it', () => {
    const { container, rerender } = render(
      <AppShell productName="Fairfold Grants">
        <h1>Programmes</h1>
      </AppShell>,
    );
    expect(container.querySelector('[data-density]')?.getAttribute('data-density')).toBe('compact');

    rerender(
      <AppShell productName="Fairfold Grants" density="comfortable">
        <h1>Programmes</h1>
      </AppShell>,
    );
    expect(container.querySelector('[data-density]')?.getAttribute('data-density')).toBe(
      'comfortable',
    );
  });
});

describe('EmptyState', () => {
  it('says what is empty and what to do next, with the action', () => {
    render(
      <EmptyState
        title="No applications yet"
        action={<a href="/share">Share the programme link</a>}
      >
        Share the programme link to start receiving applications.
      </EmptyState>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'No applications yet' })).toBeTruthy();
    expect(
      screen.getByText('Share the programme link to start receiving applications.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Share the programme link' })).toBeTruthy();
  });

  it('can sit lower in the outline', () => {
    render(
      <EmptyState title="No notes yet" headingLevel="h3">
        Add a note to record what you decided.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'No notes yet' })).toBeTruthy();
  });
});

describe('LoadingState', () => {
  it('says what is loading, in words, in a status region', () => {
    render(<LoadingState label="Loading applications" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading applications…');
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('says "Loading" when told nothing more', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });
});
