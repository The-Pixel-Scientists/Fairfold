// SPDX-License-Identifier: AGPL-3.0-or-later

import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { renderRouter, setUpRouterTests } from '../../test/routerTesting.tsx';
import { Button } from '../Button.tsx';
import { Router } from '../router/index.ts';
import { PageHeader } from './PageHeader.tsx';
import { Tag } from './Tag.tsx';

setUpRouterTests();

/** The breadcrumbs hold router links, so the header renders inside a Router. */
function renderPage(ui: ReactNode): void {
  renderRouter('/', <Router routes={[{ path: '/', title: 'Page', component: () => ui }]} />);
}

const before = (first: Node, second: Node): boolean =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('PageHeader', () => {
  it('makes the title the one h1, which script can focus but the tab key skips', () => {
    renderPage(<PageHeader title="Community Grants 2027" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Community Grants 2027' });
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('is a plain header with nothing else when only the title is set', () => {
    renderPage(<PageHeader title="Applications" />);

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the breadcrumbs, then the eyebrow, title, description and the content below', () => {
    renderPage(
      <PageHeader
        title="Community Grants 2027"
        breadcrumbs={[{ label: 'Programmes', to: '/' }, { label: 'Community Grants 2027' }]}
        eyebrow={<Tag tone="info">Open</Tag>}
        description="Applications close on 30 April 2027 at 5pm."
        actions={<Button variant="primary">Add reviewer</Button>}
      >
        <p>Last changed on 3 April 2027</p>
      </PageHeader>,
    );

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const eyebrow = screen.getByText('Open');
    const heading = screen.getByRole('heading', { level: 1 });
    const description = screen.getByText('Applications close on 30 April 2027 at 5pm.');
    const actions = screen.getByRole('button', { name: 'Add reviewer' });
    const below = screen.getByText('Last changed on 3 April 2027');

    expect(before(nav, eyebrow)).toBe(true);
    expect(before(eyebrow, heading)).toBe(true);
    expect(before(heading, description)).toBe(true);
    expect(before(description, actions)).toBe(true);
    expect(before(actions, below)).toBe(true);
  });

  it('keeps the description to a readable line length', () => {
    renderPage(<PageHeader title="Applications" description="Everything received so far." />);

    expect(screen.getByText('Everything received so far.').className).toContain('max-w-prose');
  });

  it('lets the actions wrap below the title on narrow screens', () => {
    renderPage(<PageHeader title="Applications" actions={<Button>Export applications</Button>} />);

    const row = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement;
    expect(row?.className).toContain('flex-wrap');
    expect(row?.contains(screen.getByRole('button', { name: 'Export applications' }))).toBe(true);
  });
});
