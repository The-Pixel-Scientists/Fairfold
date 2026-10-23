// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkTokens, messages } from '@pixel-scientists/domain/platform';
import { stylesheetMessages, tokenStylesheet } from '@pixel-scientists/domain/platform/settings';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { problem, stubApi } from '../../testing/api.ts';
import { openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { SESSION, administrator, file, greenTokens, heading, ok, theme } from './testing.ts';

setUpConsoleTests();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

const THEME = 'GET /console/settings/theme';
const SAVE_LOOK = 'PUT /console/settings/theme';
const SAVE = 'PUT /console/settings/theme/tokens';
const REMOVE = 'DELETE /console/settings/theme/tokens';
const PUBLIC = 'GET /public/tenants/northfield';

const picker = () => screen.getByLabelText<HTMLInputElement>('Upload stylesheet');
const sheet = (tokens = greenTokens()) => tokenStylesheet(tokens, { tenantName: 'Northfield' });
const css = (text = sheet(), name = 'northfield-theme.css') => file(text, name, 'text/css');
/** The previews of an uploaded stylesheet: every one after the page's own. */
const previews = () => [...document.querySelectorAll<HTMLElement>('[inert]')].slice(1);
const inUse = (tokens = greenTokens()) => ok(theme({ tokens }));
const problemLinks = (summary: HTMLElement) =>
  within(summary)
    .getAllByRole('link')
    .map((link) => link.textContent);

/** Stands in for the browser's download, and keeps what it was given. */
function watchDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  // jsdom has neither, and the router needs the rest of URL.
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:look';
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { blobs, names };
}

async function openLook(handlers: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const sent = stubApi({ [SESSION]: ok(administrator()), [THEME]: ok(theme()), ...handlers });
  openConsole('/northfield/settings/look');
  await heading('Look and logo');
  await screen.findByLabelText('Upload stylesheet');
  return sent;
}

describe('the stylesheet section, with no stylesheet saved', () => {
  it('explains the option in two sentences, and offers no way back', async () => {
    await openLook();

    const section = screen.getByRole('region', { name: 'Your own stylesheet' });
    const words = within(section).getByText(/^Download your look as a stylesheet/).textContent;
    expect(words.match(/\./g)).toHaveLength(2);
    expect(within(section).getByRole('button', { name: 'Download stylesheet' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Save stylesheet' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Go back to a preset' })).toBeNull();
    expect(screen.queryByText(/Your look comes from a stylesheet/)).toBeNull();
    expect(picker().getAttribute('accept')).toBe('.css,text/css');
  });

  it('downloads the current look as <slug>-theme.css', async () => {
    const user = userEvent.setup();
    const downloads = watchDownloads();
    await openLook();

    await user.click(screen.getByRole('button', { name: 'Download stylesheet' }));

    expect(downloads.names).toEqual(['northfield-theme.css']);
    const text = await downloads.blobs[0]?.text();
    expect(text).toMatch(/^\/\*\n \* The look of Northfield Foundation in /);
    expect(text).toContain('--color-accent: #1f4bb8;');
  });

  it('reads a good file, says so, and previews it in light and dark, saving nothing', async () => {
    const user = userEvent.setup();
    const sent = await openLook();

    await user.upload(picker(), css());

    expect(
      await screen.findByText(
        'Ready to save: northfield-theme.css. The preview shows it in both schemes.',
      ),
    ).toBeTruthy();
    const [light, dark] = previews();
    expect(light?.style.getPropertyValue('--color-accent')).toBe('#0b5d3b');
    expect(dark?.style.getPropertyValue('--color-accent')).toBe('#ececea');
    expect(dark?.style.getPropertyValue('--color-canvas')).toBe('#111214');
    expect(light?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(within(light as HTMLElement).queryAllByRole('button')).toEqual([]);
    expect(
      screen.getByRole('heading', { name: 'Preview of the uploaded stylesheet' }),
    ).toBeTruthy();
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
  });

  it('lists every problem with its line, takes focus, and shows no preview', async () => {
    const user = userEvent.setup();
    const sent = await openLook();
    const lines = sheet().split('\n');
    const ink = lines.findIndex((line) => line.includes('--color-ink:'));
    lines[ink] = '  --color-ink: #17181b !important;';
    lines.push('.rule { color: red; }');

    await user.upload(picker(), css(lines.join('\n')));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(problemLinks(summary)).toEqual([
      `Line ${String(ink + 1)}: ${stylesheetMessages.important}`,
      `Line ${String(lines.length)}: ${stylesheetMessages.selector}`,
    ]);
    expect(document.activeElement).toBe(summary);
    expect(picker().getAttribute('aria-invalid')).toBe('true');
    expect(previews()).toEqual([]);
    expect(screen.queryByText(/Ready to save/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save stylesheet' }));
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
  });

  it('moves focus to the file field from a problem in the summary', async () => {
    const user = userEvent.setup();
    await openLook();
    await user.upload(picker(), css('/* empty */'));

    await user.click((await screen.findAllByRole('link', { name: /^Add the/ }))[0] as HTMLElement);

    expect(document.activeElement).toBe(picker());
  });

  it('lists the failing contrast pairs from the check', async () => {
    const user = userEvent.setup();
    await openLook();
    const bad = { ...greenTokens(), dark: { ...greenTokens().dark, colorMuted: '#222222' } };
    const text = sheet(bad);
    // The dark block comes second, so its muted colour is the later line.
    const line = text.split('\n').findLastIndex((row) => row.includes('--color-muted:')) + 1;

    await user.upload(picker(), css(text));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    const items = problemLinks(summary);
    expect(items).toEqual(
      checkTokens(bad).map(({ message }) => `Line ${String(line)}: ${message}`),
    );
    expect(items.length).toBeGreaterThan(0);
  });

  it('refuses a file over 32 KB and one that is not a .css file', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openLook();

    await user.upload(picker(), css('a'.repeat(33 * 1024)));
    expect(await screen.findByRole('link', { name: stylesheetMessages.tooLarge })).toBeTruthy();

    await user.upload(picker(), css(sheet(), 'theme.txt'));
    expect(
      await screen.findByRole('link', { name: 'Choose a file that ends in .css.' }),
    ).toBeTruthy();
  });

  it('clears the problems when a better file is chosen', async () => {
    const user = userEvent.setup();
    await openLook();
    await user.upload(picker(), css('/* empty */'));
    await screen.findByRole('alert', { name: 'There is a problem' });

    await user.upload(picker(), css());

    await screen.findByText(/Ready to save/);
    expect(screen.queryByRole('alert', { name: 'There is a problem' })).toBeNull();
    expect(picker().getAttribute('aria-invalid')).toBeNull();
  });

  it('says what to do when Save stylesheet is pressed with no file', async () => {
    const user = userEvent.setup();
    const sent = await openLook();

    await user.click(screen.getByRole('button', { name: 'Save stylesheet' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary).getByRole('link', { name: 'Choose a stylesheet to save.' }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(summary);
    expect(sent.map(({ key }) => key)).not.toContain(SAVE);
  });

  it('saves the tokens, never the file, then says the stylesheet is in use', async () => {
    const user = userEvent.setup();
    const sent = await openLook({
      [SAVE]: inUse(),
      [PUBLIC]: ok({ name: 'Northfield Foundation', theme: theme() }),
    });
    await user.upload(picker(), css());
    await screen.findByText(/Ready to save/);

    await user.click(screen.getByRole('button', { name: 'Save stylesheet' }));

    expect(await screen.findByText('Stylesheet saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === SAVE)?.body).toEqual({ tokens: greenTokens() });
    expect(screen.getByText(/Your look comes from a stylesheet you saved/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go back to a preset' })).toBeTruthy();
    expect(screen.queryByText(/Ready to save/)).toBeNull();
    expect(previews()).toEqual([]);
    expect(picker().value).toBe('');
    // Once when the page opened, and again after the save.
    expect(sent.filter(({ key }) => key === PUBLIC)).toHaveLength(2);
  });

  it("shows the server's problems the same way, and keeps the file", async () => {
    const user = userEvent.setup();
    await openLook({
      [SAVE]: problem(400, messages.fixFields, [
        { field: 'body.tokens.light.colorInk', message: 'Make ink darker.' },
      ]),
    });
    await user.upload(picker(), css());
    await screen.findByText(/Ready to save/);

    await user.click(screen.getByRole('button', { name: 'Save stylesheet' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(within(summary).getByRole('link', { name: 'Make ink darker.' })).toBeTruthy();
    expect(screen.getByText(/Ready to save/)).toBeTruthy();
    expect(screen.queryByText('Stylesheet saved.')).toBeNull();
  });

  it('asks before leaving with a stylesheet chosen but not saved', async () => {
    const user = userEvent.setup();
    await openLook();
    await user.upload(picker(), css());
    await screen.findByText(/Ready to save/);

    await user.click(screen.getByRole('link', { name: 'Modules' }));

    const dialog = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(within(dialog).getByText(/You chose a stylesheet but have not saved it/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(window.location.pathname).toBe('/northfield/settings/look');
  });
});

describe('the page while a stylesheet is in use', () => {
  it('says so, and downloads the saved stylesheet rather than the preset', async () => {
    const user = userEvent.setup();
    const downloads = watchDownloads();
    await openLook({ [THEME]: inUse() });

    expect(screen.getByText(/Your look comes from a stylesheet you saved/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Download stylesheet' }));

    expect(await downloads.blobs[0]?.text()).toContain('--color-accent: #0b5d3b;');
  });

  it('asks before going back to a preset, and keeps the stylesheet if told to', async () => {
    const user = userEvent.setup();
    const sent = await openLook({ [THEME]: inUse() });

    await user.click(screen.getByRole('button', { name: 'Go back to a preset' }));

    const dialog = await screen.findByRole('dialog', { name: 'Go back to a preset?' });
    expect(within(dialog).getByText(/Standard preset with the brand colour #1f4bb8/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Keep stylesheet' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Keep stylesheet' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.map(({ key }) => key)).not.toContain(REMOVE);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Go back to a preset' }),
    );
  });

  it('removes the stylesheet when told to, and moves focus to the file field', async () => {
    const user = userEvent.setup();
    const sent = await openLook({ [THEME]: inUse(), [REMOVE]: ok(theme()) });
    await user.click(screen.getByRole('button', { name: 'Go back to a preset' }));

    await user.click(await screen.findByRole('button', { name: 'Go back to preset' }));

    expect(await screen.findByText('Your look is back to your preset.')).toBeTruthy();
    expect(sent.map(({ key }) => key)).toContain(REMOVE);
    expect(screen.queryByRole('button', { name: 'Go back to a preset' })).toBeNull();
    expect(screen.queryByText(/Your look comes from a stylesheet you saved/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(picker());
    });
  });

  it('drops the problems of a file that was refused once the stylesheet is gone', async () => {
    const user = userEvent.setup();
    await openLook({ [THEME]: inUse(), [REMOVE]: ok(theme()) });
    await user.upload(picker(), css('/* empty */'));
    await screen.findByRole('alert', { name: 'There is a problem' });
    await user.click(screen.getByRole('button', { name: 'Go back to a preset' }));

    await user.click(await screen.findByRole('button', { name: 'Go back to preset' }));

    await screen.findByText('Your look is back to your preset.');
    expect(picker().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert', { name: 'There is a problem' })).toBeNull();
  });

  it('says what went wrong when the API refuses, and keeps the stylesheet', async () => {
    const user = userEvent.setup();
    await openLook({
      [THEME]: inUse(),
      [REMOVE]: problem(503, 'The service is busy. Try again in a minute.'),
    });
    await user.click(screen.getByRole('button', { name: 'Go back to a preset' }));

    await user.click(await screen.findByRole('button', { name: 'Go back to preset' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    expect(
      within(summary).getByRole('link', { name: 'The service is busy. Try again in a minute.' }),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go back to a preset' })).toBeTruthy();
  });

  it('asks before saving a preset or brand colour over it, and sends nothing if told to keep it', async () => {
    const user = userEvent.setup();
    const sent = await openLook({ [THEME]: inUse() });

    await user.click(screen.getByRole('button', { name: 'Save look' }));

    const dialog = await screen.findByRole('dialog', { name: 'Replace your stylesheet?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep stylesheet' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(sent.map(({ key }) => key)).not.toContain(SAVE_LOOK);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save look' }));
  });

  it('saves the preset and brand colour once the person agrees to replace the stylesheet', async () => {
    const user = userEvent.setup();
    const sent = await openLook({
      [THEME]: inUse(),
      [SAVE_LOOK]: (body) => ok({ ...(body as object), hasLogo: false, tokens: null }),
    });
    await user.click(screen.getByRole('radio', { name: 'Square' }));
    await user.click(screen.getByRole('button', { name: 'Save look' }));

    await user.click(await screen.findByRole('button', { name: 'Replace stylesheet' }));

    expect(await screen.findByText('Look saved.')).toBeTruthy();
    expect(sent.find(({ key }) => key === SAVE_LOOK)?.body).toEqual({
      brandColour: '#1f4bb8',
      preset: 'square',
    });
    expect(screen.queryByText(/Your look comes from a stylesheet you saved/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back to a preset' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not ask when there is no stylesheet to replace', async () => {
    const user = userEvent.setup();
    const sent = await openLook({
      [SAVE_LOOK]: (body) => ok({ ...(body as object), hasLogo: false }),
    });

    await user.click(screen.getByRole('radio', { name: 'Square' }));
    await user.click(screen.getByRole('button', { name: 'Save look' }));

    expect(await screen.findByText('Look saved.')).toBeTruthy();
    expect(sent.map(({ key }) => key)).toContain(SAVE_LOOK);
  });
});
