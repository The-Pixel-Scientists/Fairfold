// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role } from '@pixel-scientists/domain/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ids, programme, round } from '../../programme/fixtures.ts';
import { consoleSession, problem, stubApi } from '../../testing/api.ts';
import { expectTitle, openConsole, setUpConsoleTests } from '../../testing/render.tsx';
import { ok } from '../settings/testing.ts';

setUpConsoleTests();

const SESSION = 'GET /auth/session';
const PROGRAMMES = 'GET /console/programmes';
const PUBLISHER = 'GET /console/exports/360giving/publisher';
const SAVE_PUBLISHER = 'PUT /console/exports/360giving/publisher';
const EXPORT = 'GET /console/exports/360giving';
const SNAPSHOT = '/api/console/warehouse/snapshot';

const publisher = {
  funderIdentifier: 'GB-CHC-7654321',
  funderName: 'Northfield Foundation',
  identifierPrefix: '360G-northfield',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const grant = {
  id: `360G-northfield-${ids.round}`,
  title: 'Autumn 2026',
  description: 'Grants for places where neighbours meet.',
  currency: 'GBP',
  amountAwarded: 25000,
  awardDate: '2026-11-20',
  recipientOrganization: [{ id: 'GB-CHC-1234567', name: 'Riverside Lunch Club' }],
  fundingOrganization: [{ id: 'GB-CHC-7654321', name: 'Northfield Foundation' }],
  grantProgramme: [{ title: 'Community Spaces Fund' }],
  dateModified: '2026-11-20T09:30:00.000Z',
};

const programmes = ok({ programmes: [{ ...programme, rounds: [round] }] });

const released = ok({
  file: { grants: [grant] },
  summary: {
    grants: 1,
    unverifiedRecipients: [{ id: ids.author, name: 'Riverside Lunch Club' }],
  },
});

const sql = '-- warehouse snapshot\nBEGIN;\nCOMMIT;\n';

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('The file could not be read.'));
    };
    reader.readAsText(blob);
  });

/** What the browser was asked to save, and what each file held. */
const saved: { name: string; text: Promise<string> }[] = [];

beforeEach(() => {
  saved.length = 0;
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${String(blobs.size)}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob) saved.push({ name: this.download, text: readBlob(blob) });
  });
});

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

/** The snapshot download answers as the API does, a script as an attachment, and everything else goes to the stub. */
function answerSnapshot(reply: Response | (() => Promise<Response>)) {
  const rest = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) =>
      url === SNAPSHOT
        ? typeof reply === 'function'
          ? reply()
          : Promise.resolve(reply)
        : rest(url, init),
    ),
  );
}

const script = () =>
  new Response(sql, {
    status: 200,
    headers: { 'content-type': 'application/sql', 'content-disposition': 'attachment' },
  });

async function openData(roles: Role[] = ['tenant_admin', 'programme_manager'], more = {}) {
  const sent = stubApi({
    [SESSION]: ok(consoleSession({ roles })),
    [PUBLISHER]: ok({ publisher }),
    [PROGRAMMES]: programmes,
    ...more,
  });
  openConsole('/northfield/data');
  await screen.findByRole('heading', { level: 1, name: 'Data' });
  return sent;
}

const button = (name: string) => screen.findByRole('button', { name });

describe('the Data page', () => {
  it('is in the navigation, and has a section for each download', async () => {
    await openData();

    await expectTitle('Data – Fairfold Grants console');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Data' }).getAttribute('href')).toBe(
      '/northfield/data',
    );
    await screen.findByLabelText('Funder identifier');
    expect(screen.getByRole('heading', { level: 2, name: '360Giving file' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Warehouse snapshot' })).toBeTruthy();
    expect(screen.getAllByText(/Anything an applicant wrote/)).toHaveLength(2);
    expect(screen.getAllByText('Awards that have not been released')).toHaveLength(1);
  });

  it('tells someone without either permission what to do next', async () => {
    stubApi({ [SESSION]: ok(consoleSession({ roles: ['programme_manager'] })) });
    openConsole('/northfield/data');

    await screen.findByRole('heading', { level: 2, name: 'You cannot download data' });
    expect(screen.getByText(/Ask an administrator/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download warehouse snapshot' })).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
        name: 'Data',
      }),
    ).toBeNull();
  });
});

describe('the 360Giving file', () => {
  it('asks for the publisher details first, checks them, and saves them', async () => {
    const sent = await openData(undefined, {
      [PUBLISHER]: ok({ publisher: null }),
      [SAVE_PUBLISHER]: ok(publisher),
    });
    await screen.findByText('Save your publisher details first');
    expect(screen.queryByRole('button', { name: 'Download 360Giving file' })).toBeNull();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Funder identifier'), 'northfield');
    await user.type(screen.getByLabelText('Funder name'), 'Northfield Foundation');
    await user.type(screen.getByLabelText('Grant identifier prefix'), 'northfield');
    await user.click(await button('Save publisher details'));

    const summary = await screen.findByRole('alert');
    expect(
      within(summary).getByText(/Enter the funder's identifier from org-id.guide/),
    ).toBeTruthy();
    expect(within(summary).getByText(/Enter the prefix 360Giving gave the funder/)).toBeTruthy();
    expect(sent.some(({ key }) => key === SAVE_PUBLISHER)).toBe(false);

    await user.clear(screen.getByLabelText('Funder identifier'));
    await user.type(screen.getByLabelText('Funder identifier'), 'GB-CHC-7654321');
    await user.clear(screen.getByLabelText('Grant identifier prefix'));
    await user.type(screen.getByLabelText('Grant identifier prefix'), '360G-northfield');
    await user.click(screen.getByRole('button', { name: 'Save publisher details' }));

    await screen.findByText('Publisher details saved.');
    expect(sent.find(({ key }) => key === SAVE_PUBLISHER)?.body).toEqual({
      funderIdentifier: 'GB-CHC-7654321',
      funderName: 'Northfield Foundation',
      identifierPrefix: '360G-northfield',
    });
    expect(await button('Download 360Giving file')).toBeTruthy();
  });

  it('downloads the chosen round, saves the file and says how many grants and which recipients to check', async () => {
    const sent = await openData(undefined, { [`${EXPORT}?roundId=${ids.round}`]: released });
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Awards to include'), 'Autumn 2026');
    await user.click(await button('Download 360Giving file'));

    await screen.findByText('Saved 1 grant to 360giving-community-spaces-fund-autumn-2026.json');
    expect(sent.some(({ key }) => key === `${EXPORT}?roundId=${ids.round}`)).toBe(true);
    expect(saved.map(({ name }) => name)).toEqual([
      '360giving-community-spaces-fund-autumn-2026.json',
    ]);
    expect(JSON.parse((await saved[0]?.text) ?? '')).toEqual({ grants: [grant] });
    const warning = screen.getByText(/has an identifier nobody has verified/).closest('div');
    expect(within(warning as HTMLElement).getByText('Riverside Lunch Club')).toBeTruthy();
  });

  it('asks for a whole programme when it is chosen, and saves nothing when no award is released', async () => {
    await openData(undefined, {
      [`${EXPORT}?programmeId=${ids.programme}`]: ok({
        file: { grants: [] },
        summary: { grants: 0, unverifiedRecipients: [] },
      }),
    });
    const user = userEvent.setup();

    await user.click(await button('Download 360Giving file'));

    await screen.findByText('Community Spaces Fund, all rounds has no released awards yet');
    expect(screen.getByText(/Release decisions for a round/)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('shows why the file could not be made, in words', async () => {
    await openData(undefined, {
      [`${EXPORT}?programmeId=${ids.programme}`]: problem(
        400,
        'This export has more than 5,000 grants. Choose one round to export fewer.',
      ),
    });
    const user = userEvent.setup();

    await user.click(await button('Download 360Giving file'));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('We could not make the file')).toBeTruthy();
    expect(within(alert).getByText(/Choose one round to export fewer/)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('says a download is under way, and ignores a second press', async () => {
    await openData();
    let finish: () => void = () => undefined;
    const rest = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) =>
        url.startsWith('/api/console/exports/360giving?')
          ? new Promise<Response>((resolve) => {
              finish = () => {
                resolve(
                  new Response(JSON.stringify(released.body), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  }),
                );
              };
            })
          : rest(url, init),
      ),
    );
    const user = userEvent.setup();

    await user.click(await button('Download 360Giving file'));
    await user.click(screen.getByRole('button', { name: 'Download 360Giving file' }));

    expect(screen.getByText('Making the 360Giving file')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download 360Giving file' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/360giving?')),
    ).toHaveLength(1);
    finish();
    await screen.findByText(/Saved 1 grant to/);
    expect(screen.queryByText('Making the 360Giving file')).toBeNull();
  });

  it('leads someone with no programmes to create one', async () => {
    await openData(undefined, { [PROGRAMMES]: ok({ programmes: [] }) });

    await screen.findByText('No programmes yet');
    expect(screen.getByRole('link', { name: 'Go to programmes' }).getAttribute('href')).toBe(
      '/northfield/',
    );
  });

  it('explains that choosing a programme needs the programme manager role', async () => {
    await openData(['tenant_admin']);

    await screen.findByText('You cannot choose a programme or round');
    expect(screen.queryByLabelText('Awards to include')).toBeNull();
  });

  it('can be read again when the details could not be loaded', async () => {
    let reads = 0;
    await openData(undefined, {
      [PUBLISHER]: () => (++reads === 1 ? problem(503, 'The service is busy.') : ok({ publisher })),
    });

    await screen.findByText('The service is busy.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Funder identifier')).toBeTruthy();
  });
});

describe('the warehouse snapshot', () => {
  it('lists what it holds, from the model, and what it leaves out', async () => {
    await openData();
    const user = userEvent.setup();

    await screen.findByRole('heading', { level: 2, name: 'Warehouse snapshot' });
    expect(screen.getByText('Personal details of any kind')).toBeTruthy();
    await user.click(screen.getByText(/Show the \d+ tables/));
    const table = screen.getByRole('table', { name: 'Tables in the warehouse snapshot' });
    expect(within(table).getByText('grants_application')).toBeTruthy();
    expect(within(table).getByText(/Released awards only/)).toBeTruthy();
    const guide = screen.getByRole('link', { name: /How to load the snapshot/ });
    expect(guide.getAttribute('href')).toMatch(/warehouse-snapshot\.md$/);
    expect(guide.getAttribute('rel')).toBe('noreferrer');
  });

  it('saves the script as an .sql file and says so', async () => {
    await openData();
    answerSnapshot(script());
    const user = userEvent.setup();

    await user.click(await button('Download warehouse snapshot'));

    await screen.findByText('Saved northfield-warehouse-snapshot.sql');
    expect(saved.map(({ name }) => name)).toEqual(['northfield-warehouse-snapshot.sql']);
    expect(await saved[0]?.text).toBe(sql);
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === SNAPSHOT) ?? [];
    expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
  });

  it('shows the API’s words when the snapshot is refused', async () => {
    await openData();
    answerSnapshot(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Problem',
          status: 413,
          detail: 'This snapshot is larger than 50 MB. Ask your operator for a copy.',
          requestId: 'req_test',
        }),
        { status: 413, headers: { 'content-type': 'application/json' } },
      ),
    );
    const user = userEvent.setup();

    await user.click(await button('Download warehouse snapshot'));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('We could not make the snapshot')).toBeTruthy();
    expect(within(alert).getByText(/Ask your operator for a copy/)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('does not save an answer that is not a script', async () => {
    await openData();
    answerSnapshot(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    const user = userEvent.setup();

    await user.click(await button('Download warehouse snapshot'));

    await screen.findByText('Something went wrong on our side. Try again in a few minutes.');
    expect(saved).toEqual([]);
  });

  it('says when it cannot reach the service, and can be tried again', async () => {
    await openData();
    let reached = false;
    answerSnapshot(() => {
      if (reached) return Promise.resolve(script());
      reached = true;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const user = userEvent.setup();

    await user.click(await button('Download warehouse snapshot'));
    await screen.findByText(/We could not reach the service/);
    await user.click(screen.getByRole('button', { name: 'Download warehouse snapshot' }));

    await screen.findByText('Saved northfield-warehouse-snapshot.sql');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('is left out for someone who may take only the 360Giving file', async () => {
    stubApi({
      [SESSION]: ok({
        ...consoleSession({ roles: ['tenant_admin'] }),
        permissions: ['grants.data.export'],
      }),
      [PUBLISHER]: ok({ publisher }),
    });
    openConsole('/northfield/data');

    await screen.findByRole('heading', { level: 2, name: '360Giving file' });
    expect(screen.queryByRole('heading', { name: 'Warehouse snapshot' })).toBeNull();
  });
});
