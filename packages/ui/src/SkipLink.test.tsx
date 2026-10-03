// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { SkipLink } from './SkipLink.tsx';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function Page() {
  return (
    <>
      <SkipLink />
      <nav aria-label="Main">
        <a href="/one">One</a>
        <a href="/two">Two</a>
      </nav>
      <main id="main-content">
        <h1>Programmes</h1>
        <a href="/inside">Inside the page</a>
      </main>
    </>
  );
}

describe('SkipLink', () => {
  it('is the first stop in the tab order', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
  });

  it('links to the main content, as a real link', () => {
    render(<Page />);
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#main-content',
    );
  });

  it('moves focus to the main content on Enter, past the navigation', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.tab();
    await user.keyboard('{Enter}');

    const main = screen.getByRole('main');
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
    // The next Tab lands inside the page, not back in the navigation.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Inside the page' }));
  });

  it('moves focus on a click, and leaves the address alone', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(screen.getByRole('link', { name: 'Skip to main content' }));

    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(window.location.hash).toBe('');
  });

  it('can point at another element and carry other words', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink targetId="results">Skip to results</SkipLink>
        <div id="results">Results</div>
      </>,
    );

    await user.click(screen.getByRole('link', { name: 'Skip to results' }));

    expect(document.activeElement).toBe(document.getElementById('results'));
  });

  it('leaves the browser to follow the link when its target is missing', () => {
    render(<SkipLink targetId="nowhere" />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
