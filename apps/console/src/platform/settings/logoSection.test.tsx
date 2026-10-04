// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { problem, stubApi } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import {
  SESSION,
  administrator,
  file,
  heading,
  ok,
  pngHeader,
  publicTenant,
  theme,
} from './testing.ts';

setUpConsoleTests();

const THEME = 'GET /console/settings/theme';
const UPLOAD = 'PUT /console/settings/theme/logo';
const REMOVE = 'DELETE /console/settings/theme/logo';
const PUBLIC = 'GET /public/tenants/northfield';

const picker = () => screen.getByLabelText<HTMLInputElement>('Logo file');

async function openLook(handlers: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const sent = stubApi({ [SESSION]: ok(administrator()), [THEME]: ok(theme()), ...handlers });
  openConsole('/northfield/settings/look');
  await heading('Look and logo');
  await screen.findByLabelText('Logo file');
  return sent;
}

describe('the logo section', () => {
  it('says there is no logo yet, and what to upload', async () => {
    await openLook();

    expect(
      screen.getByText('You have no logo yet, so your name shows in the header.'),
    ).toBeTruthy();
    expect(
      screen.getByText('A PNG or WebP image of 200 KB or less, no larger than 1200 by 400 pixels.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
    expect(picker().getAttribute('accept')).toBe('image/png,image/webp');
  });

  it('shows the logo with the funder name as its alternative text, and offers to remove it', async () => {
    await openLook({
      [THEME]: ok(theme({ hasLogo: true })),
      [PUBLIC]: ok(publicTenant({ hasLogo: true })),
    });

    const logo = await screen.findAllByRole('img', { name: 'Northfield Foundation' });
    expect(logo[0]?.getAttribute('src')).toBe('/api/public/tenants/northfield/logo');
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeTruthy();
  });

  it('checks a file before it is sent, in the same words as the server, and sends nothing', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const sent = await openLook();

    await user.upload(picker(), file('<svg></svg>', 'logo.svg', 'image/svg+xml'));

    expect((await screen.findAllByText(messages.logoType)).length).toBeGreaterThan(0);
    expect(picker().getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/Ready to upload/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Upload logo' }));
    expect(sent.map(({ key }) => key)).not.toContain(UPLOAD);
  });

  it('says what to do when Upload logo is pressed with no file, and moves focus to the file field', async () => {
    const user = userEvent.setup();
    await openLook();

    await user.click(screen.getByRole('button', { name: 'Upload logo' }));

    expect((await screen.findAllByText(messages.logoType)).length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(picker());
  });

  it('uploads a file that passes, shows it, and says so', async () => {
    const user = userEvent.setup();
    const sent = await openLook({
      [UPLOAD]: ok(theme({ hasLogo: true })),
      [PUBLIC]: () => ok(publicTenant({ hasLogo: sent.some(({ key }) => key === UPLOAD) })),
    });

    await user.upload(picker(), file(pngHeader(300, 100), 'northfield.png'));
    expect(
      await screen.findByText('Ready to upload: northfield.png, 300 by 100 pixels.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Upload logo' }));

    expect(await screen.findByText('Logo saved.')).toBeTruthy();
    const body = sent.find(({ key }) => key === UPLOAD)?.body as { data: string };
    expect(atob(body.data)).toHaveLength(33);
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeTruthy();
    expect(screen.queryByText(/Ready to upload/)).toBeNull();
    expect(picker().value).toBe('');
    const logos = await screen.findAllByRole('img', { name: 'Northfield Foundation' });
    expect(logos.length).toBeGreaterThan(0);
  });

  it("shows the API's refusal of a file in the same place, and keeps the choice", async () => {
    const user = userEvent.setup();
    await openLook({
      [UPLOAD]: problem(400, messages.fixFields, [
        { field: 'body.data', message: messages.logoUnreadable },
      ]),
    });
    await user.upload(picker(), file(pngHeader(300, 100)));
    await screen.findByText(/Ready to upload/);

    await user.click(screen.getByRole('button', { name: 'Upload logo' }));

    expect((await screen.findAllByText(messages.logoUnreadable)).length).toBeGreaterThan(0);
    expect(picker().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(picker());
    expect(screen.queryByText('Logo saved.')).toBeNull();
  });

  it('removes the logo and moves focus to the file field, since the button is gone', async () => {
    const user = userEvent.setup();
    const sent = await openLook({
      [THEME]: ok(theme({ hasLogo: true })),
      [REMOVE]: ok(theme({ hasLogo: false })),
      [PUBLIC]: ok(publicTenant({ hasLogo: true })),
    });

    await user.click(await screen.findByRole('button', { name: 'Remove logo' }));

    expect(await screen.findByText('Logo removed.')).toBeTruthy();
    expect(sent.map(({ key }) => key)).toContain(REMOVE);
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
    expect(
      screen.getByText('You have no logo yet, so your name shows in the header.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(picker());
  });

  it('asks before leaving with a logo chosen but not uploaded', async () => {
    const user = userEvent.setup();
    await openLook();
    await user.upload(picker(), file(pngHeader(300, 100)));
    await screen.findByText(/Ready to upload/);

    await user.click(screen.getByRole('link', { name: 'Modules' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(within(dialog).getByText(/You chose a logo but have not uploaded it/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(window.location.pathname).toBe('/northfield/settings/look');
  });
});
