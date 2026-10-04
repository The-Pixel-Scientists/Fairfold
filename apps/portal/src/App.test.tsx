// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productName } from '@pixel-scientists/domain/platform';

import { App } from './App.tsx';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  document.title = '';
});

function openPortal(path = '/') {
  window.history.replaceState(null, '', path);
  return render(<App />);
}

/** Each paragraph and heading in the main landmark, split into sentences. */
function sentencesIn(main: HTMLElement): string[] {
  return Array.from(main.querySelectorAll('h1, h2, p'))
    .flatMap((block) => block.textContent.split(/(?<=[.?!])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

describe('home page', () => {
  it('has one h1, a title that says where you are, and a main landmark', async () => {
    openPortal();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apply for a grant' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe(`Apply for a grant – ${productName}`);
    expect(screen.getByRole('banner').textContent).toContain(productName);
    expect(screen.getByRole('main').contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
  });

  it('says plainly that no grants are open and what to do next', async () => {
    openPortal();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No grants are open yet' }),
    ).toBeTruthy();
    expect(screen.getByText(/You do not need to do anything now\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read how applying works' }).getAttribute('href')).toBe(
      '/how-applying-works',
    );
  });

  it('says what will happen, in the future tense, because applying is not built yet', async () => {
    openPortal();
    await screen.findByRole('heading', { level: 1 });

    expect(
      screen.getByText(
        'When a grant opens, you will check that you can apply first. Then you will fill in your application at your own pace.',
      ),
    ).toBeTruthy();
  });

  it('has no navigation landmark, because each screen is one task', async () => {
    openPortal();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('links the product name in the header to the home page, which is marked as the current page', async () => {
    openPortal();
    await screen.findByRole('heading', { level: 1 });

    const home = within(screen.getByRole('banner')).getByRole('link', { name: productName });
    expect(home.getAttribute('href')).toBe('/');
    expect(home.getAttribute('aria-current')).toBe('page');
  });

  it('puts the skip link first and moves focus to the main content from the keyboard', async () => {
    const user = userEvent.setup();
    openPortal();
    await screen.findByRole('heading', { level: 1 });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('leaves focus where the browser put it on the first load', async () => {
    openPortal();
    await screen.findByRole('heading', { level: 1 });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('moving between pages', () => {
  it('moves focus to the new heading and updates the title when you follow a link', async () => {
    const user = userEvent.setup();
    openPortal();
    await screen.findByRole('heading', { level: 1, name: 'Apply for a grant' });

    screen.getByRole('link', { name: 'Read how applying works' }).focus();
    await user.keyboard('{Enter}');

    const heading = await screen.findByRole('heading', { level: 1, name: 'How applying works' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe(`How applying works – ${productName}`);
    expect(window.location.pathname).toBe('/how-applying-works');
    expect(screen.getByRole('status').textContent).toBe('Navigated to How applying works');
  });

  it('goes back to the home page from the link at the end of the page', async () => {
    const user = userEvent.setup();
    openPortal('/how-applying-works');
    await screen.findByRole('heading', { level: 1, name: 'How applying works' });

    await user.click(screen.getByRole('link', { name: 'Back to the home page' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Apply for a grant' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe(`Apply for a grant – ${productName}`);
  });

  it('goes home from the header link, with focus on the home heading', async () => {
    const user = userEvent.setup();
    openPortal('/how-applying-works');
    await screen.findByRole('heading', { level: 1, name: 'How applying works' });

    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: productName }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Apply for a grant' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(document.title).toBe(`Apply for a grant – ${productName}`);
    expect(window.location.pathname).toBe('/');
  });

  it('says so, and offers a way home, when the address matches nothing', async () => {
    openPortal('/nothing/here');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(document.title).toBe(`Page not found – ${productName}`);
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});

describe('how applying works page', () => {
  it('has one h1 and one h2 for each of the four steps, in order', async () => {
    openPortal('/how-applying-works');
    await screen.findByRole('heading', { level: 1, name: 'How applying works' });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const steps = screen.getAllByRole('heading', { level: 2 });
    expect(steps.map((step) => step.textContent)).toEqual([
      'Step 1Check you can apply',
      'Step 2Write your application',
      'Step 3Check and send',
      'Step 4Wait for the decision',
    ]);
  });

  it('opens by saying nobody can apply yet, then describes the steps in the future tense', async () => {
    openPortal('/how-applying-works');
    await screen.findByRole('heading', { level: 1, name: 'How applying works' });

    expect(
      screen.getByText(
        /^No grants are open yet, so you cannot apply today. This is how applying will work./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/We will save your answers as you go./)).toBeTruthy();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
  });

  it('never hints at an outcome before the funder has released it', async () => {
    openPortal('/how-applying-works');
    await screen.findByRole('heading', { level: 1, name: 'How applying works' });

    expect(screen.getByText(/only after the funder has released it/)).toBeTruthy();
  });
});

describe('plain English', () => {
  it.each(['/', '/how-applying-works', '/nothing/here'])(
    'keeps every sentence on %s short, for a reading age of about 11',
    async (path) => {
      openPortal(path);
      await screen.findByRole('heading', { level: 1 });

      for (const sentence of sentencesIn(screen.getByRole('main'))) {
        const words = sentence.split(/\s+/).length;
        expect(words, sentence).toBeLessThanOrEqual(25);
      }
    },
  );

  it('uses buttons and links that say what happens, never a bare "Submit" or "OK"', async () => {
    openPortal();
    await screen.findByRole('heading', { level: 1 });

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(control.textContent).not.toMatch(/^(submit|ok|click here|here)$/i);
    }
  });
});
