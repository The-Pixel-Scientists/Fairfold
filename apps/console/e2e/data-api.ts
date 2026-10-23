// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the Data page specs: an administrator who also
// sets up programmes, a funder with one programme and two rounds, one of them
// with released awards, and the two downloads. Answers are plain JSON in the
// shape of the contracts; this stand-in checks what it takes against the
// contract too, as the console checks each answer it gets.

import {
  publisherSettingInputSchema,
  threeSixtyGivingExportSchema,
  threeSixtyGivingQuerySchema,
} from '@pixel-scientists/grants/contracts';
import type { PublisherSetting, ThreeSixtyGivingGrant } from '@pixel-scientists/grants/contracts';
import type { Page } from '@playwright/test';

import { problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';

export const ids = {
  programme: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  autumn: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  spring: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  riverside: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
  harbour: 'e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091',
} as const;

export const SNAPSHOT_PATH = '/api/console/warehouse/snapshot';

/** What the snapshot script holds: enough to check the file saved is the one sent. */
export const SNAPSHOT = `-- Warehouse snapshot for Northfield Foundation
BEGIN;
CREATE TABLE programme (id uuid PRIMARY KEY, title text NOT NULL);
COPY programme (id, title) FROM stdin;
${ids.programme}\tCommunity Spaces Fund
\\.
COMMIT;
`;

export const publisher: PublisherSetting = {
  funderIdentifier: 'GB-CHC-7654321',
  funderName: 'Northfield Foundation',
  identifierPrefix: '360G-northfield',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const money = { amountMinor: 0, currency: 'GBP' } as const;

const round = (id: string, title: string, opensAt: string, closesAt: string) => ({
  id,
  programmeId: ids.programme,
  title,
  opensAt,
  closesAt,
  timeZone: 'Europe/London',
  budget: { ...money, amountMinor: 15_000_000 },
  awardMinimum: { ...money, amountMinor: 500_000 },
  awardMaximum: { ...money, amountMinor: 2_500_000 },
  latePolicy: 'refuse',
});

const grant = (
  recipient: string,
  name: string,
  amountAwarded: number,
  awardDate: string,
): ThreeSixtyGivingGrant => ({
  id: `360G-northfield-${recipient}`,
  title: 'Autumn 2026',
  description: 'Grants for places where neighbours meet.',
  currency: 'GBP',
  amountAwarded,
  awardDate,
  recipientOrganization: [{ id: `360G-northfield-${recipient}`, name }],
  fundingOrganization: [{ id: publisher.funderIdentifier, name: publisher.funderName }],
  grantProgramme: [{ title: 'Community Spaces Fund' }],
  dateModified: `${awardDate}T09:30:00.000Z`,
});

/** The released awards of the autumn round: the first recipient has no verified identifier, the second does not need one shown. */
export const awards: ThreeSixtyGivingGrant[] = [
  grant(ids.riverside, 'Riverside Lunch Club', 25_000, '2026-11-20'),
  grant(ids.harbour, 'Harbour Street Hall', 12_500.5, '2026-11-21'),
];

const administrator = [
  'platform.warehouse.export',
  'grants.data.export',
  'grants.programmes.manage',
  'platform.settings.manage',
];

export interface DataStub {
  /** The publisher details the funder has saved, or null. A spec may change it between steps. */
  publisher: PublisherSetting | null;
  sent: SentRequest[];
  /** How many times each download was asked for. */
  asked: { exports: number; snapshots: number };
}

export interface DataOptions {
  publisher?: PublisherSetting | null;
  programmes?: unknown[];
  permissions?: string[];
  /** Replaces the snapshot download's answer. */
  snapshot?: { status: number; contentType?: string; body: string };
  /** Replaces answers, keyed like `GET /console/programmes`. */
  more?: Record<string, Handler>;
}

const ok = (body: unknown): Reply => ({ status: 200, body });

/** A signed-in administrator of a funder with a programme and its rounds. */
export async function stubData(page: Page, options: DataOptions = {}): Promise<DataStub> {
  const {
    publisher: start = publisher,
    permissions = administrator,
    snapshot = { status: 200, contentType: 'application/sql', body: SNAPSHOT },
    more = {},
  } = options;
  const programmes = options.programmes ?? [
    {
      id: ids.programme,
      title: 'Community Spaces Fund',
      summary: 'Grants for places where neighbours meet.',
      status: 'open',
      rounds: [
        round(ids.autumn, 'Autumn 2026', '2026-10-12T09:00', '2026-11-02T17:00'),
        round(ids.spring, 'Spring 2027', '2027-02-02T09:00', '2027-03-02T17:00'),
      ],
    },
  ];
  const stub: DataStub = {
    publisher: start,
    sent: [],
    asked: { exports: 0, snapshots: 0 },
  };

  stub.sent = await stubSignedIn(
    page,
    { permissions },
    {
      'GET /console/programmes': ok({ programmes }),
      'GET /console/exports/360giving/publisher': () => ok({ publisher: stub.publisher }),
      'PUT /console/exports/360giving/publisher': (body) => {
        const parsed = publisherSettingInputSchema.safeParse(body);
        if (!parsed.success) return problem(400, 'These details are not valid.');
        stub.publisher = { ...parsed.data, updatedAt: '2026-10-28T10:00:00.000Z' };
        return ok(stub.publisher);
      },
      ...more,
    },
  );

  await page.route(
    (url) => url.pathname === '/api/console/exports/360giving',
    async (route) => {
      const url = new URL(route.request().url());
      stub.sent.push({ key: `GET /console/exports/360giving${url.search}`, body: undefined });
      stub.asked.exports += 1;
      const query = threeSixtyGivingQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      let reply: Reply;
      if (stub.publisher === null) {
        reply = problem(
          409,
          "Save the funder's 360Giving details before you export. They are printed in every file.",
        );
      } else if (!query.success) {
        reply = problem(400, 'Choose a programme or a round, not both.');
      } else {
        const grants =
          query.data.roundId === ids.autumn || query.data.programmeId === ids.programme
            ? awards
            : [];
        reply = ok(
          threeSixtyGivingExportSchema.parse({
            file: { grants },
            summary: {
              grants: grants.length,
              unverifiedRecipients: grants.slice(0, 1).map((item) => ({
                id: ids.riverside,
                name: item.recipientOrganization[0]?.name ?? '',
              })),
            },
          }),
        );
      }
      await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: JSON.stringify(reply.body),
      });
    },
  );

  await page.route(
    (url) => url.pathname === SNAPSHOT_PATH,
    async (route) => {
      stub.sent.push({ key: 'GET /console/warehouse/snapshot', body: undefined });
      stub.asked.snapshots += 1;
      await route.fulfill({
        status: snapshot.status,
        contentType: snapshot.contentType ?? 'application/json',
        headers: { 'content-disposition': 'attachment; filename="snapshot.sql"' },
        body: snapshot.body,
      });
    },
  );
  return stub;
}
