// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { renderRouter, setUpRouterTests } from '../../test/routerTesting.tsx';
import { Router } from '../router/index.ts';
import { Breadcrumbs } from './Breadcrumbs.tsx';

setUpRouterTests();

/** Breadcrumbs hold router links, so they render inside a Router. */
function renderPage(ui: ReactNode): void {
  renderRouter('/', <Router routes={[{ path: '/', title: 'Page', component: () => ui }]} />);
}

const trail = [
  { label: 'Programmes', to: '/' },
  { label: 'Community Grants 2027', to: '/rounds/spring-2027' },
  { label: 'Applications' },
];

describe('Breadcrumbs', () => {
  it('is a navigation landmark named Breadcrumb that holds an ordered list', () => {
    renderPage(<Breadcrumbs items={trail} />);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('ol')).toBeTruthy();
    expect(
      within(nav)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Programmes', 'Community Grants 2027', 'Applications']);
  });

  it('links the ancestors and leaves the current page as plain text', () => {
    renderPage(<Breadcrumbs items={trail} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Programmes', 'Community Grants 2027']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/rounds/spring-2027']);

    const current = screen.getByText('Applications');
    expect(current.tagName).toBe('SPAN');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Applications' })).toBeNull();
  });

  it('shows an ancestor with no page as text, and marks only the last item as current', () => {
    renderPage(
      <Breadcrumbs
        items={[{ label: 'Programmes' }, { label: 'Spring 2027', to: '/x' }, { label: 'Reviews' }]}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Programmes' })).toBeNull();
    expect(screen.getByText('Programmes').getAttribute('aria-current')).toBeNull();
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('hides the separators from assistive technology', () => {
    renderPage(<Breadcrumbs items={trail} />);

    const separators = document.querySelectorAll('nav svg');
    expect(separators).toHaveLength(trail.length - 1);
    for (const separator of separators) expect(separator.getAttribute('aria-hidden')).toBe('true');
  });

  it('wraps rather than scrolls on narrow screens', () => {
    renderPage(<Breadcrumbs items={trail} />);

    expect(screen.getByRole('list').className).toContain('flex-wrap');
  });
});
