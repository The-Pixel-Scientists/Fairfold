// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Answers save as they change, say so, and are never lost: not when a save
// fails, not when the answers saved are not the ones the page was built on,
// and not when the applicant leaves.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../testing/api.ts';
import type { Reply } from '../testing/api.ts';
import { APPLICATION_ID, application, applicationServer } from '../testing/apply.ts';
import { signedIn } from '../testing/party.ts';
import { openPortal, setUpPortalTests } from '../testing/render.tsx';
import { RETRY_DELAYS_MS, SAVE_DELAY_MS } from './useAutosave.ts';

setUpPortalTests();

const home = `/northfield/applications/${APPLICATION_ID}`;
const about = `${home}/sections/s_about`;
const PUT = `PUT /portal/applications/${APPLICATION_ID}/answers`;
const eligible = application({ answers: { f_charity: true } });
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const status = () => within(screen.getByRole('main')).getAllByRole('status')[0];
const name = () => screen.getByRole('textbox', { name: /^Organisation name/ });

/** The saves go through `save`, which a test can make fail. */
function open(path: string, save?: (body: unknown, accept: () => Reply) => Reply | Promise<Reply>) {
  const server = applicationServer(eligible);
  const accept = (body: unknown) => server.handlers[PUT]?.(body) ?? problem(500, 'No stand-in.');
  const sent = stubApi({
    ...signedIn,
    ...server.handlers,
    [PUT]: (body) => (save ? save(body, () => accept(body)) : accept(body)),
  });
  openPortal(path);
  return { server, sent };
}

const enough = { timeout: SAVE_DELAY_MS * 5 };

describe('autosave', () => {
  it('saves a moment after a change and says so', async () => {
    const user = userEvent.setup();
    const { server } = open(about);
    await h1('About your organisation');

    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');

    expect(server.saved).toEqual([]);
    await waitFor(() => {
      expect(server.saved).toEqual([
        { basedOn: 1, answers: { f_charity: true, f_name: 'Eastmere' } },
      ]);
    }, enough);
    await waitFor(() => {
      expect(status()?.textContent).toMatch(/^Saved at \d/);
    });
  });

  it('says it is saving while the request is on its way', async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const { server } = open(
      about,
      (_body, accept) =>
        new Promise<Reply>((resolve) => {
          finish = () => {
            resolve(accept());
          };
        }),
    );
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'E');

    await waitFor(() => {
      expect(finish).toBeDefined();
    }, enough);
    expect(status()?.textContent).toBe('Saving…');
    finish?.();

    await waitFor(() => {
      expect(status()?.textContent).toMatch(/^Saved at/);
    });
    expect(server.saved).toHaveLength(1);
  });

  it('saves when the applicant leaves, and the next page shows what was saved', async () => {
    const user = userEvent.setup();
    const { server } = open(about);
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Community Spaces Fund, Spring 2027',
      }),
    );

    await h1('Your application');
    expect(server.saved).toHaveLength(1);
    expect(await screen.findByText('2 questions to finish.')).toBeTruthy();
    expect(server.current.answers).toMatchObject({ f_name: 'Eastmere' });
  });

  it('keeps an answer that cannot be saved yet on screen, says so, and asks for it to be fixed', async () => {
    const user = userEvent.setup();
    const { server } = open(about);
    await h1('About your organisation');
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');
    await user.type(screen.getByRole('textbox', { name: /^Contact email address/ }), 'ada@');

    expect(
      await screen.findByText('Some answers are not saved yet. Fix them to save them.', {}, enough),
    ).toBeTruthy();
    expect(server.current.answers).toEqual({ f_charity: true, f_name: 'Eastmere' });
    expect(screen.getByRole('textbox', { name: /^Contact email address/ })).toHaveProperty(
      'value',
      'ada@',
    );

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getAllByRole('link')).toHaveLength(1);
    expect(window.location.pathname).toBe(about);

    await user.type(screen.getByRole('textbox', { name: /^Contact email address/ }), 'example.org');
    await waitFor(() => {
      expect(server.current.answers).toMatchObject({ f_contact: 'ada@example.org' });
    }, enough);
    expect(screen.queryByText('Some answers are not saved yet. Fix them to save them.')).toBeNull();
  });

  it('keeps the answers on screen when a save fails, and saves them when the applicant tries again', async () => {
    const user = userEvent.setup();
    let failing = true;
    const { server } = open(about, (_body, accept) =>
      failing ? problem(503, 'The service is busy.') : accept(),
    );
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');

    await waitFor(() => {
      expect(status()?.textContent).toBe('Not saved. Check your connection and try again');
    }, enough);
    expect(name()).toHaveProperty('value', 'Eastmere');
    expect(server.saved).toEqual([]);

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try saving again' }));

    await waitFor(() => {
      expect(status()?.textContent).toMatch(/^Saved at/);
    });
    expect(server.saved).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try saving again' })).toBeNull();
  });

  it('tries again by itself after a failed save', async () => {
    const user = userEvent.setup();
    let failing = true;
    const { server } = open(about, (_body, accept) =>
      failing ? problem(503, 'The service is busy.') : accept(),
    );
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');
    await waitFor(() => {
      expect(status()?.textContent).toMatch(/^Not saved/);
    }, enough);

    failing = false;

    await waitFor(
      () => {
        expect(server.saved).toHaveLength(1);
      },
      { timeout: (RETRY_DELAYS_MS[0] ?? 0) + 3000 },
    );
    expect(name()).toHaveProperty('value', 'Eastmere');
  }, 20_000);

  it('does not move on from a save that failed', async () => {
    const user = userEvent.setup();
    open(about, () => problem(0, 'No connection.'));
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');

    await user.click(screen.getByRole('button', { name: 'Save and come back later' }));

    expect(await screen.findByText('Not saved. Check your connection and try again')).toBeTruthy();
    expect(window.location.pathname).toBe(about);
  });

  it('offers the latest saved answers when they have changed somewhere else', async () => {
    const user = userEvent.setup();
    const { server } = open(about);
    await h1('About your organisation');
    server.update({
      answersVersion: 5,
      answers: { f_charity: true, f_name: 'Saved elsewhere' },
    });

    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');

    const alert = await screen.findByRole('alert', {}, enough);
    expect(within(alert).getByText('Your answers were saved somewhere else')).toBeTruthy();
    expect(name()).toHaveProperty('value', 'Eastmere');
    expect(server.saved).toEqual([]);

    await user.click(within(alert).getByRole('button', { name: 'Show the latest saved answers' }));

    await waitFor(() => {
      expect(name()).toHaveProperty('value', 'Saved elsewhere');
    });
    expect(screen.queryByRole('alert')).toBeNull();

    await user.type(name(), '!');
    await waitFor(() => {
      expect(server.saved).toEqual([
        { basedOn: 5, answers: { f_charity: true, f_name: 'Saved elsewhere!' } },
      ]);
    }, enough);
  });

  it('asks before leaving answers that are not saved, and puts them back on return', async () => {
    const user = userEvent.setup();
    let failing = true;
    const { server } = open(about, (_body, accept) =>
      failing ? problem(503, 'The service is busy.') : accept(),
    );
    await user.type(await screen.findByRole('textbox', { name: /^Organisation name/ }), 'Eastmere');
    await waitFor(() => {
      expect(status()?.textContent).toMatch(/^Not saved/);
    }, enough);
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));

    await user.click(crumbs.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(
      within(dialog).getByText(
        'Some of your answers are not saved. If you leave this page, you may lose them.',
      ),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(window.location.pathname).toBe(about);

    await user.click(crumbs.getByRole('link', { name: 'Community Spaces Fund, Spring 2027' }));
    await user.click(await screen.findByRole('button', { name: 'Leave and lose changes' }));
    await h1('Your application');
    failing = false;

    await user.click(
      await screen.findByRole('link', { name: 'Continue with About your organisation' }),
    );
    await h1('About your organisation');
    expect(
      await screen.findByText('We kept what you typed last time. We are saving it now.'),
    ).toBeTruthy();
    expect(name()).toHaveProperty('value', 'Eastmere');
    await waitFor(() => {
      expect(server.current.answers).toMatchObject({ f_name: 'Eastmere' });
    }, enough);
  });
});
