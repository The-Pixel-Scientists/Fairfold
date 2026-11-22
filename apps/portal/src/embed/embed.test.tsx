// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { challengeReply, publicForm } from '../testing/forms.ts';
import { stubApi } from '../testing/api.ts';
import { EmbedApp } from './EmbedApp.tsx';
import { isPublicFormPath } from './PublicFormRouter.tsx';

vi.mock('../../../../modules/forms/src/portal/proof.ts', () => ({
  solveInWorker: vi.fn(() => Promise.resolve(Array.from({ length: 16 }, (_, index) => index))),
}));

const entry = 'embed/EmbedApp.tsx';
const FORM_ID = '2e4a6c8d-0b1f-4d3e-8a5c-7f9b1d3e5a70';
const FORM = `GET /public/tenants/northfield/forms/${FORM_ID}`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

const raw = import.meta.glob<string>('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The parts of `spec` read from the folder `from`, as `a/b/c.ts`. */
function resolved(from: string[], spec: string): string {
  const parts = [...from];
  for (const part of spec.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Every portal source file, by its path under src, such as `embed/EmbedApp.tsx`. */
const sources = new Map(
  Object.entries(raw).map(([key, source]) => [resolved(['embed'], key), source]),
);

/** Every portal file the embed entry reaches through relative imports. */
function reachable(start: string): string[] {
  const seen = new Set<string>();
  const queue = [start];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const folder = file.split('/').slice(0, -1);
    for (const [, spec] of (sources.get(file) ?? '').matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
      const target = resolved(folder, spec ?? '');
      if (sources.has(target)) queue.push(target);
    }
  }
  return [...seen];
}

describe('the embed entry', () => {
  it('imports no sign-in, account, shell or session page', () => {
    const files = reachable(entry);

    expect(files).toContain('embed/PublicFormRouter.tsx');
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect(file, file).not.toMatch(/^(auth|account|shell|apply)\//);
    }
  });

  it('never loads a session', () => {
    for (const file of reachable(entry).filter((name) => name.startsWith('embed/'))) {
      if (file.endsWith('.test.tsx')) continue;
      expect(sources.get(file), file).not.toMatch(/loadSession|SessionProvider/);
    }
  });

  it('shows an anonymous form with the funder name, and reads no session', async () => {
    const sent = stubApi({
      [FORM]: { status: 200, body: publicForm() },
      [`${FORM}/challenge`]: { status: 200, body: challengeReply() },
    });
    window.history.replaceState(null, '', `/northfield/forms/${FORM_ID}`);

    render(<EmbedApp />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Funder A feedback' }),
    ).toBeTruthy();
    expect(screen.getByText('Northfield Foundation')).toBeTruthy();
    expect(screen.getByText(/saved on this device for this website only/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull();
    expect(sent.some(({ key }) => key.includes('/auth/'))).toBe(false);
  });

  it('sends no cookie on any call', async () => {
    stubApi({
      [FORM]: { status: 200, body: publicForm() },
      [`${FORM}/challenge`]: { status: 200, body: challengeReply() },
    });
    window.history.replaceState(null, '', `/northfield/forms/${FORM_ID}`);

    render(<EmbedApp />);
    await screen.findByRole('heading', { level: 1, name: 'Funder A feedback' });

    const calls = vi.mocked(fetch).mock.calls as [string, RequestInit][];
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map(([, init]) => init.credentials)).toEqual(calls.map(() => 'omit'));
  });

  it('shows the same calm page for any address that is not a public form', () => {
    window.history.replaceState(null, '', '/northfield/applications');

    render(<EmbedApp />);

    expect(screen.getByRole('heading', { name: 'We cannot find this form' })).toBeTruthy();
  });
});

describe('isPublicFormPath', () => {
  it('matches only the funder slug, forms and a form id', () => {
    expect(isPublicFormPath('northfield', `/northfield/forms/${FORM_ID}`)).toBe(true);
    expect(isPublicFormPath('northfield', `/northfield/forms/${FORM_ID}/`)).toBe(true);
    expect(isPublicFormPath('northfield', `/northfield/forms/${FORM_ID}/extra`)).toBe(false);
    expect(isPublicFormPath('northfield', '/northfield/forms/not-an-id')).toBe(false);
    expect(isPublicFormPath('northfield', `/eastmere/forms/${FORM_ID}`)).toBe(false);
    expect(isPublicFormPath('northfield', `/northfield/your-forms/${FORM_ID}`)).toBe(false);
  });
});
