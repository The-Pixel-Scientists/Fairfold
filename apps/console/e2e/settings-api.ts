// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the settings specs: a funder that keeps what is
// saved, so a spec can change something and see it afterwards, and answers
// for the stylesheet and logo that the console loads by address. Answers are
// plain JSON in the shape of the contracts in packages/domain/src/platform/settings;
// the console checks each one against its contract.

import type { Page } from '@playwright/test';

import { consoleSession, stubSignedIn } from './auth-api.ts';
import type { Handler, SentRequest } from './auth-api.ts';
import { solidPng } from './png.ts';

export interface Funder {
  name: string;
  timeZone: string;
  fiscalYearStartMonth: number;
  brandColour: string;
  preset: 'standard' | 'rounded' | 'square';
  hasLogo: boolean;
  grants: boolean;
}

export const standard: Funder = {
  name: 'Northfield Foundation',
  timeZone: 'Europe/London',
  fiscalYearStartMonth: 4,
  brandColour: '#1f4bb8',
  preset: 'standard',
  hasLogo: false,
  grants: true,
};

/** A saved custom look, for the specs that check the console in it. */
export const custom: Funder = {
  ...standard,
  brandColour: '#0b5d3b',
  preset: 'rounded',
  hasLogo: true,
};

const administrator = [
  'platform.settings.manage',
  'platform.members.manage',
  'platform.audit.read',
  'platform.warehouse.export',
  'grants.data.export',
];

/** Each preset's radius and surfaces, as `theme.css` sets them (packages/domain/src/platform/settings/theme-css.ts). */
const presets = {
  standard: { radius: ['0.25rem', '0.375rem', '0.5rem'], canvas: '#f5f6f8', sunken: '#eceef2' },
  rounded: { radius: ['0.5rem', '0.75rem', '1rem'], canvas: '#f8f7f4', sunken: '#f0efea' },
  square: { radius: ['0', '0', '0'], canvas: '#f6f6f6', sunken: '#eeeeee' },
} as const;

/** A colour `amount` of the way towards another, as `#rrggbb`. */
function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function themeCss({ brandColour, preset }: Pick<Funder, 'brandColour' | 'preset'>): string {
  const shape = presets[preset];
  const properties: [string, string][] = [
    ['--color-accent', brandColour],
    ['--color-accent-hover', mix(brandColour, '#000000', 0.2)],
    ['--color-accent-soft', mix(brandColour, '#ffffff', 0.9)],
    ['--color-canvas', shape.canvas],
    ['--color-sunken', shape.sunken],
    ['--radius-sm', shape.radius[0]],
    ['--radius-md', shape.radius[1]],
    ['--radius-lg', shape.radius[2]],
  ];
  return `:root {\n${properties.map(([name, value]) => `  ${name}: ${value};\n`).join('')}}\n`;
}

const tokens = (funder: Funder) => ({
  brandColour: funder.brandColour,
  preset: funder.preset,
  hasLogo: funder.hasLogo,
});

export interface SettingsStub {
  /** What is saved. A spec may change it between steps. */
  funder: Funder;
  sent: SentRequest[];
}

/**
 * A signed-in administrator of a funder that keeps what is saved. `more`
 * adds or replaces answers, keyed like `GET /console/settings`.
 */
export async function stubSettings(
  page: Page,
  start: Funder = standard,
  more: Record<string, Handler> = {},
  permissions: string[] = administrator,
): Promise<SettingsStub> {
  const funder = { ...start };
  const ok = (body: unknown) => ({ status: 200, body });
  const sent = await stubSignedIn(
    page,
    {},
    {
      // With Grants off the session drops its permissions.
      'GET /auth/session': () =>
        ok(
          consoleSession({
            permissions: permissions.filter(
              (permission) => funder.grants || !permission.startsWith('grants.'),
            ),
          }),
        ),
      'GET /public/tenants/northfield': () => ok({ name: funder.name, theme: tokens(funder) }),
      'GET /console/settings': () =>
        ok({
          name: funder.name,
          timeZone: funder.timeZone,
          fiscalYearStartMonth: funder.fiscalYearStartMonth,
        }),
      'PUT /console/settings': (body) => {
        Object.assign(funder, body);
        return ok(body);
      },
      'GET /console/settings/theme': () => ok(tokens(funder)),
      'PUT /console/settings/theme': (body) => {
        Object.assign(funder, body);
        return ok(tokens(funder));
      },
      'PUT /console/settings/theme/logo': () => {
        funder.hasLogo = true;
        return ok(tokens(funder));
      },
      'DELETE /console/settings/theme/logo': () => {
        funder.hasLogo = false;
        return ok(tokens(funder));
      },
      'GET /console/settings/modules': () =>
        ok({ modules: [{ module: 'grants', enabled: funder.grants }] }),
      'PATCH /console/settings/modules': (body) => {
        funder.grants = (body as { enabled: boolean }).enabled;
        return ok({ modules: [{ module: 'grants', enabled: funder.grants }] });
      },
      ...more,
    },
  );

  // Routes added later answer first, so these take the stylesheet and logo from the JSON catch-all.
  await page.route('**/api/public/tenants/northfield/theme.css', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: themeCss(funder) }),
  );
  await page.route('**/api/public/tenants/northfield/logo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: solidPng(240, 80, [11, 93, 59]),
    }),
  );
  return { funder, sent };
}
