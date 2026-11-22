// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.public_open_rounds() (migration 0071, ADR 0035): what it returns
// for an open round, the one empty answer for every not-found case, each a
// single field away from an open round, the eligibility summary, the order
// and the cap of 100.

import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorIn, testSlug } from '../tenants.ts';
import {
  addOpenRound,
  changeIn,
  createGrantsTenant,
  ELIGIBILITY,
  type GrantsTenant,
  openRounds,
  publishForm,
  roundIds,
} from './fixtures.ts';

let tenant: GrantsTenant;
let round: string;

beforeAll(async () => {
  tenant = await createGrantsTenant();
  round = await addOpenRound(tenant);
}, 60_000);

describe('grants.public_open_rounds()', { timeout: 60_000 }, () => {
  it("returns an open round's public fields and eligibility summary", async () => {
    const [row, ...rest] = await openRounds(tenant.slug);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      round_id: round,
      programme_title: 'Programme A',
      programme_summary: 'Grants for synthetic test groups.',
      round_title: 'Round 1',
      timezone: 'Europe/London',
      award_min_minor: '10000',
      award_max_minor: '500000',
      currency: 'GBP',
      eligibility: ELIGIBILITY,
    });
    expect(row?.['opens_at']).toBeInstanceOf(Date);
    expect(row?.['closes_at']).toBeInstanceOf(Date);
  });

  it('returns no private value: no budget, description, late policy, ids or other form text', async () => {
    const text = JSON.stringify(await openRounds(tenant.slug));
    for (const hidden of [
      '9876543',
      'Private description text',
      'accept_and_flag',
      tenant.id,
      tenant.member,
      'Hint stays private',
      'Organisation name',
      'How much do you need?',
      'elsewhere',
      'stopWhen',
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it.each([
    ['an unknown slug', () => testSlug()],
    ['a misspelt slug', () => `${tenant.slug.slice(0, -1)}x`],
    ['a differently cased slug', () => tenant.slug.toUpperCase()],
    ['a padded slug', () => ` ${tenant.slug}`],
    ['a quoted slug', () => `${tenant.slug}' OR true --`],
    ['no slug', () => null],
  ])('returns nothing for %s', async (_, slug) => {
    expect(await roundIds(slug())).toEqual([]);
  });

  it.each([
    ['a suspended tenant', "UPDATE app.tenant SET status = 'suspended'"],
    ['grants switched off', 'UPDATE app.tenant_module SET enabled = false'],
    ['grants never switched on', 'DELETE FROM app.tenant_module'],
    ['a draft programme', "UPDATE grants.programme SET status = 'draft'"],
    ['a closed programme', "UPDATE grants.programme SET status = 'closed'"],
    ['a round not yet open', "UPDATE grants.round SET opens_at = now() + interval '1 day'"],
    ['a round past its close', "UPDATE grants.round SET closes_at = now() - interval '1 second'"],
  ])('returns nothing for %s, and only that change hides the round', async (_, change) => {
    const own = await createGrantsTenant();
    const id = await addOpenRound(own);
    expect(await roundIds(own.slug)).toEqual([id]);
    await changeIn(own, change);
    expect(await roundIds(own.slug)).toEqual([]);
  });

  it('returns nothing for a round with only a draft form, until it is published', async () => {
    const own = await createGrantsTenant();
    const id = await addOpenRound(own, {}, null);
    await asMigratorIn(own.id, (client) =>
      client.query(
        "INSERT INTO grants.form_version (tenant_id, round_id, version, definition) VALUES ($1, $2, 1, '{}')",
        [own.id, id],
      ),
    );
    expect(await roundIds(own.slug)).toEqual([]);
    await changeIn(
      own,
      "UPDATE grants.form_version SET status = 'published', published_at = now(), published_by = $1",
      [own.member],
    );
    expect(await roundIds(own.slug)).toEqual([id]);
  });

  it('summarises the latest published version, never a draft, in form order, capped', async () => {
    const own = await createGrantsTenant();
    const id = await addOpenRound(own);
    const fields = Array.from({ length: 51 }, (_, index) => ({
      id: `q${String(index)}`,
      type: 'yes_no',
      label: index === 0 ? 'L'.repeat(600) : `Question ${String(index)}`,
      eligibility: { stopWhen: false, explanation: 'E'.repeat(index === 0 ? 1200 : 10) },
    }));
    await asMigratorIn(own.id, async (client) => {
      await publishForm(client, own, id, 2, { sections: [{ id: 's', title: 'S', fields }] });
      await client.query(
        "INSERT INTO grants.form_version (tenant_id, round_id, version, definition) VALUES ($1, $2, 3, '{}')",
        [own.id, id],
      );
    });
    const summary = (await openRounds(own.slug))[0]?.['eligibility'] as {
      label: string;
      explanation: string;
    }[];
    expect(summary).toHaveLength(50);
    expect(summary[0]).toEqual({ label: 'L'.repeat(500), explanation: 'E'.repeat(1000) });
    expect(summary[49]?.label).toBe('Question 49');
  });

  it.each([
    ['sections that are not a list', { sections: 'none' }],
    [
      'a label that is not text',
      { sections: [{ fields: [{ type: 'yes_no', label: 5, eligibility: { explanation: 'E' } }] }] },
    ],
    [
      'eligibility on another type',
      {
        sections: [
          { fields: [{ type: 'short_text', label: 'Q', eligibility: { explanation: 'E' } }] },
        ],
      },
    ],
  ])('gives an empty summary, raising nothing, for %s', async (_, definition) => {
    const own = await createGrantsTenant();
    const id = await addOpenRound(own, {}, definition);
    expect(await openRounds(own.slug)).toMatchObject([{ round_id: id, eligibility: [] }]);
  });

  it('orders by closing time then round title, and returns at most 100', async () => {
    const own = await createGrantsTenant();
    await asMigratorIn(own.id, (client) =>
      client.query(
        `WITH p AS (
           INSERT INTO grants.programme (tenant_id, title, summary, status)
           VALUES ($1, 'Programme B', 'Synthetic.', 'open') RETURNING id),
         r AS (
           INSERT INTO grants.round (tenant_id, programme_id, title, opens_at, closes_at, timezone,
                                     budget_minor, award_min_minor, award_max_minor, late_policy)
           SELECT $1, p.id, 'Round ' || lpad(i::text, 3, '0'), now() - interval '1 day',
                  now() + ((i + 1) / 2) * interval '1 hour', 'Europe/London', 1000, 100, 1000,
                  'refuse'
             FROM p, generate_series(101, 1, -1) AS i
           RETURNING id)
         INSERT INTO grants.form_version (tenant_id, round_id, version, status, definition,
                                          published_at, published_by)
         SELECT $1, r.id, 1, 'published', '{}', now(), $2 FROM r`,
        [own.id, own.member],
      ),
    );
    const titles = (await openRounds(own.slug)).map((row) => row['round_title']);
    expect(titles).toEqual(
      Array.from({ length: 100 }, (_, index) => `Round ${String(index + 1).padStart(3, '0')}`),
    );
  });
});
