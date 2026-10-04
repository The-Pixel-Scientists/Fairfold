// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pages, routes and helpers shared by the router's tests. Not exported from
// the package.

import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Input } from '../src/FormField.tsx';
import { PageHeading } from '../src/PageHeading.tsx';
import {
  Link,
  Router,
  useLeaveGuard,
  useNavigate,
  useParams,
  useSearch,
} from '../src/router/index.ts';
import type { RouteDefinition, SearchSchema } from '../src/router/index.ts';

export function Home() {
  return (
    <>
      <PageHeading>Programmes</PageHeading>
      <Link to="/applications/42">Open application 42</Link>
      <Link to="/edit">Edit this programme</Link>
      <Link to="/missing">Open a missing page</Link>
      <Link to="/">Programmes home</Link>
    </>
  );
}

export function Application() {
  const { id } = useParams();
  return (
    <>
      <PageHeading>Application {id}</PageHeading>
      <Link to="/">Back to programmes</Link>
    </>
  );
}

export function Editor() {
  const [dirty, setDirty] = useState(false);
  useLeaveGuard(dirty);
  return (
    <>
      <PageHeading>Edit programme</PageHeading>
      <Input
        aria-label="Programme name"
        onChange={() => {
          setDirty(true);
        }}
      />
      <Link to="/">Back to programmes</Link>
    </>
  );
}

export const filters: SearchSchema<{ stage?: string; owner?: string | string[] }> = {
  safeParse(input) {
    const record = input as Record<string, string | string[]>;
    if (Object.keys(record).some((key) => key !== 'stage' && key !== 'owner')) {
      return { success: false, error: 'Unknown filter' };
    }
    return { success: true, data: record };
  },
};

export function Filters() {
  const navigate = useNavigate();
  const result = useSearch(filters);
  return (
    <>
      <PageHeading>Applications</PageHeading>
      <button
        type="button"
        onClick={() => {
          navigate('/filters?stage=review&owner=a&owner=b');
        }}
      >
        Filter by review
      </button>
      <button
        type="button"
        onClick={() => {
          navigate('/filters#history');
        }}
      >
        Jump to history
      </button>
      <p data-testid="filters">{JSON.stringify(result)}</p>
    </>
  );
}

export const routes: readonly RouteDefinition[] = [
  { path: '/', title: 'Programmes', component: Home },
  {
    path: '/applications/:id',
    title: (params) => `Application ${params['id'] ?? ''}`,
    component: Application,
  },
  { path: '/edit', title: 'Edit programme', component: Editor },
  { path: '/filters', title: 'Applications', component: Filters },
];

export function renderRouter(path = '/', ui?: ReactNode): RenderResult {
  window.history.replaceState(null, '', path);
  return render(ui ?? <Router routes={routes} titleSuffix="Fairfold Grants console" />);
}

export function announcement(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
}

export function activeHeading(): string | undefined {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.tagName === 'H1' ? active.textContent : undefined;
}

/** Stop jsdom trying to follow a link, and report whether the router left the click alone. */
export function watchClicks(): { defaultPrevented: boolean[] } {
  const seen: boolean[] = [];
  const listener = (event: Event) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener('click', listener);
  onCleanup(() => {
    document.removeEventListener('click', listener);
  });
  return { defaultPrevented: seen };
}

const cleanups: (() => void)[] = [];
let scrollToSpy: MockInstance<typeof window.scrollTo> | undefined;

/** Undo something when the current test ends. */
export function onCleanup(undo: () => void): void {
  cleanups.push(undo);
}

/** The spy on window.scrollTo, which the set-up file stubs because jsdom does not implement it. */
export function scrollTo(): MockInstance<typeof window.scrollTo> {
  if (!scrollToSpy) throw new Error('Call setUpRouterTests() at the top of the test file.');
  return scrollToSpy;
}

/** Call once at the top of a test file: spy on scrolling, and reset the page between tests. */
export function setUpRouterTests(): void {
  beforeEach(() => {
    scrollToSpy = vi.spyOn(window, 'scrollTo');
  });

  afterEach(() => {
    for (const undo of cleanups.splice(0)) undo();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    document.title = '';
  });
}
