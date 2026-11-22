// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms tables' rules (migration 0079): published versions never
// change and record the form's respondents; responses pin a version of
// their own form published for their route, keep their form, route and
// respondent, and once submitted only lose answers; the database sets every
// time and the retention; app_api writes no anonymous response or token;
// stored answers are clean. Each statement runs in a rolled-back
// transaction.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addFormsParts,
  anonymousRow,
  DEFINITION,
  draftRow,
  formRow,
  insertOutcome,
  publishVersion,
  responseRow,
  SIGNED_IN_DEFINITION,
  tokenRow,
  type FormsParts,
} from './fixtures.ts';

let tenant: TestTenant;
let parts: FormsParts;
let draft: string;
let signedInForm: string;
let signedInVersion: string;
let anonymousOnly: string;
let response: string;
let anonymous: string;
let token: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    parts = await addFormsParts(client, tenant);
    draft = await insertRow(
      client,
      'forms.form_version',
      draftRow(tenant, parts.form, parts.member, { version: 2 }),
    );
    signedInForm = await insertRow(
      client,
      'forms.form',
      formRow(tenant, parts.member, { respondents: 'signed_in', retention_months: 24 }),
    );
    signedInVersion = await publishVersion(client, tenant, signedInForm, parts.member, {
      definition: JSON.stringify(SIGNED_IN_DEFINITION),
    });
    const anonymousForm = await insertRow(
      client,
      'forms.form',
      formRow(tenant, parts.member, { respondents: 'anonymous' }),
    );
    anonymousOnly = await publishVersion(client, tenant, anonymousForm, parts.member);
    response = await insertRow(client, 'forms.response', responseRow(tenant, parts));
    anonymous = await insertRow(client, 'forms.response', anonymousRow(tenant, parts));
    token = await insertRow(client, 'forms.respondent_token', tokenRow(tenant, anonymous));
  });
}, 60_000);

const asApi = <T>(work: (client: pg.Client) => Promise<T>) => asRoleIn('app_api', tenant.id, work);
const asMigrator = <T>(work: (client: pg.Client) => Promise<T>) =>
  asRoleIn('migrator', tenant.id, work);
const one = async (client: pg.ClientBase, text: string, values: unknown[]) =>
  (await client.query<Record<string, unknown>>(text, values)).rows[0];

describe('forms.form', { timeout: 30_000 }, () => {
  it('keeps an anonymous form to 12 months, closes after it opens, and needs a title', async () => {
    const refused = [
      { respondents: 'anonymous', retention_months: 13 },
      { respondents: 'both', retention_months: 24 },
      { retention_months: 121 },
      { opens_at: '2027-03-02T00:00:00Z', closes_at: '2027-03-01T00:00:00Z' },
      { title: ' Leading space' },
      { title: 'Hidden\u200bspace' },
      { description: '' },
    ];
    for (const change of refused) {
      expect(
        await insertOutcome('app_api', tenant, 'forms.form', formRow(tenant, parts.member, change)),
        JSON.stringify(change),
      ).toBe('23514');
    }
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'forms.form',
        formRow(tenant, parts.member, { respondents: 'signed_in', retention_months: 120 }),
      ),
    ).toBe('ok');
  });

  it('archives once, at the database time, and is never deleted by app_api', async () => {
    await asApi(async (client) => {
      const archive = 'UPDATE forms.form SET archived_at = $1 WHERE id = $2 RETURNING archived_at';
      const row = await one(client, archive, ['2001-01-01T00:00:00Z', signedInForm]);
      expect((row?.['archived_at'] as Date).getFullYear()).toBeGreaterThan(2001);
      expect(await outcome(client, archive, [null, signedInForm])).toBe('23514');
      expect(await outcome(client, 'DELETE FROM forms.form WHERE id = $1', [signedInForm])).toBe(
        '42501',
      );
    });
  });
});

describe('forms.form_version', { timeout: 30_000 }, () => {
  const publish = `UPDATE forms.form_version
                      SET status = 'published', published_by = $1, config_version_id = $2
                    WHERE id = $3`;

  it('publishes a draft once, setting the time and the form respondents', async () => {
    await asApi(async (client) => {
      const config = await one(
        client,
        `INSERT INTO app.config_version (tenant_id, entity_type, entity_id, version, author_id, diff)
         VALUES ($1, 'forms.form', $2, 7, $3, '{}') RETURNING id`,
        [tenant.id, parts.form, parts.member],
      );
      const values = [parts.member, config?.['id'], draft];
      expect((await client.query(publish, values)).rowCount).toBe(1);
      const row = await one(
        client,
        'SELECT respondents, published_at FROM forms.form_version WHERE id = $1',
        [draft],
      );
      expect(row?.['respondents']).toBe('both');
      expect(row?.['published_at']).toBeInstanceOf(Date);
      expect((await client.query(publish, values)).rowCount).toBe(0);
    });
  });

  it('never changes or removes a published version, for any role', async () => {
    for (const run of [asApi, asMigrator]) {
      await run(async (client) => {
        const update = await client.query(
          "UPDATE forms.form_version SET definition = '{}' WHERE id = $1",
          [parts.version],
        );
        const remove = await client.query('DELETE FROM forms.form_version WHERE id = $1', [
          parts.version,
        ]);
        expect([update.rowCount, remove.rowCount]).toEqual([0, 0]);
      });
    }
  });

  it('lets app_api discard a draft, and holds one draft per form', async () => {
    await asApi(async (client) => {
      expect(
        await outcome(
          client,
          'INSERT INTO forms.form_version (tenant_id, form_id, version, created_by, updated_by) VALUES ($1, $2, 3, $3, $3)',
          [tenant.id, parts.form, parts.member],
        ),
      ).toBe('23505');
      expect(
        (await client.query('DELETE FROM forms.form_version WHERE id = $1', [draft])).rowCount,
      ).toBe(1);
    });
  });

  it('refuses a file or aggregate-only question in a version anyone can answer', async () => {
    const withFile = {
      sections: [
        {
          ...DEFINITION.sections[0],
          fields: [{ id: 'f_upload', type: 'file', label: 'Upload', audiences: ['applicant'] }],
        },
      ],
    };
    await asMigrator(async (client) => {
      for (const definition of [withFile, SIGNED_IN_DEFINITION]) {
        expect(
          await outcome(
            client,
            `INSERT INTO forms.form_version (tenant_id, form_id, version, status, definition,
                                             published_by, config_version_id, created_by, updated_by)
             SELECT tenant_id, form_id, 5, 'published', $2, published_by, config_version_id,
                    created_by, updated_by
               FROM forms.form_version WHERE id = $1`,
            [parts.version, JSON.stringify(definition)],
          ),
        ).toBe('23514');
      }
    });
  });
});

describe('forms.response', { timeout: 30_000 }, () => {
  it('takes no anonymous response from app_api', async () => {
    // Every column here is granted, so the refusal is the insert policy's.
    const row = responseRow(tenant, parts, {
      route: 'anonymous',
      respondent_person_id: null,
      created_by: null,
    });
    expect(await insertOutcome('app_api', tenant, 'forms.response', row)).toBe('42501');
    expect(
      await insertOutcome('app_api', tenant, 'forms.response', anonymousRow(tenant, parts)),
    ).toBe('42501');
  });

  it('pins a published version of its own form, for its route', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ form_version_id: draft }, '55000'],
      [{ form_version_id: signedInVersion }, '23503'],
      [{ form_version_id: anonymousOnly }, '23503'],
    ];
    for (const [change, code] of cases) {
      expect(
        await insertOutcome(
          'app_api',
          tenant,
          'forms.response',
          responseRow(tenant, parts, change),
        ),
        JSON.stringify(change),
      ).toBe(code);
    }
    const anonymousForm = await asMigrator(async (client) =>
      String(
        (
          await one(client, 'SELECT form_id FROM forms.form_version WHERE id = $1', [anonymousOnly])
        )?.['form_id'],
      ),
    );
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'forms.response',
        responseRow(tenant, { ...parts, form: anonymousForm, version: anonymousOnly }),
      ),
    ).toBe('55000');
  });

  it('sets the submission time and retention, which app_api cannot write', async () => {
    await asApi(async (client) => {
      const row = await one(
        client,
        `SELECT submitted_at, retain_until, retain_until = submitted_at + interval '12 months' AS months
           FROM forms.response WHERE id = $1`,
        [response],
      );
      expect(row?.['months']).toBe(true);
      for (const column of ['submitted_at', 'retain_until', 'id', 'created_at']) {
        expect(
          await outcome(client, `UPDATE forms.response SET ${column} = ${column} WHERE id = $1`, [
            response,
          ]),
          column,
        ).toBe('42501');
      }
    });
    await asMigrator(async (client) => {
      const row = await one(
        client,
        "UPDATE forms.response SET retain_until = now() + interval '9 years' WHERE id = $1 RETURNING retain_until < now() + interval '2 years' AS kept",
        [response],
      );
      expect(row?.['kept']).toBe(true);
    });
  });

  it('keeps its form, route, respondent and keys, whoever writes', async () => {
    await asMigrator(async (client) => {
      for (const [column, value] of [
        ['route', 'anonymous'],
        ['respondent_person_id', null],
        ['form_id', signedInForm],
        ['request_hash', Buffer.alloc(32)],
      ] as const) {
        expect(
          await outcome(client, `UPDATE forms.response SET ${column} = $1 WHERE id = $2`, [
            value,
            response,
          ]),
          column,
        ).toBe('55000');
      }
    });
  });

  it('once submitted, only loses answers, and stays submitted and pinned', async () => {
    await asApi(async (client) => {
      const change = (answers: object) =>
        outcome(client, 'UPDATE forms.response SET answers = $1 WHERE id = $2', [
          JSON.stringify(answers),
          response,
        ]);
      expect(await change({ f_rating: 4, f_venue: 'north' })).toBe('ok');
      expect(await change({ f_name: 'Another Person', f_rating: 4, f_venue: 'north' })).toBe(
        '55000',
      );
      expect(
        await change({ f_name: 'Synthetic Person', f_rating: 4, f_venue: 'north', f_extra: 'x' }),
      ).toBe('55000');
      expect(
        await outcome(client, "UPDATE forms.response SET status = 'draft' WHERE id = $1", [
          response,
        ]),
      ).toBe('55000');
    });
  });

  it('lets a draft move to another published version, then submits it', async () => {
    await asApi(async (client) => {
      const second = await asMigratorIn(tenant.id, (migrator) =>
        publishVersion(migrator, tenant, parts.form, parts.member, { version: 3 }),
      );
      const row = await one(
        client,
        `INSERT INTO forms.response (tenant_id, form_id, form_version_id, route, respondent_person_id,
                                     answers, created_by, updated_by)
         VALUES ($1, $2, $3, 'signed_in', $4, '{}', $5, $5) RETURNING id, submitted_at, retain_until`,
        [tenant.id, parts.form, parts.version, parts.person, parts.member],
      );
      expect([row?.['submitted_at'], row?.['retain_until']]).toEqual([null, null]);
      const submitted = await one(
        client,
        `UPDATE forms.response SET form_version_id = $1, status = 'submitted' WHERE id = $2
         RETURNING submitted_at IS NOT NULL AND retain_until IS NOT NULL AS timed`,
        [second, row?.['id']],
      );
      expect(submitted?.['timed']).toBe(true);
      expect(
        await outcome(client, 'UPDATE forms.response SET form_version_id = $1 WHERE id = $2', [
          parts.version,
          row?.['id'],
        ]),
      ).toBe('55000');
    });
  });

  it('marks spam with a reason, a member and the database time, all together', async () => {
    await asApi(async (client) => {
      const mark = 'UPDATE forms.response SET spam_reason = $1, spam_marked_by = $2 WHERE id = $3';
      expect(await outcome(client, mark, ['automated', null, anonymous])).toBe('23514');
      expect(await outcome(client, mark, ['phishing', parts.member, anonymous])).toBe('23514');
      await client.query(mark, ['automated', parts.member, anonymous]);
      const row = await one(client, 'SELECT spam_marked_at FROM forms.response WHERE id = $1', [
        anonymous,
      ]);
      expect(row?.['spam_marked_at']).toBeInstanceOf(Date);
      await client.query(mark, [null, null, anonymous]);
      const undone = await one(client, 'SELECT spam_marked_at FROM forms.response WHERE id = $1', [
        anonymous,
      ]);
      expect(undone?.['spam_marked_at']).toBeNull();
      expect(await outcome(client, 'DELETE FROM forms.response WHERE id = $1', [anonymous])).toBe(
        '42501',
      );
    });
  });
});

describe('forms.answers_are_clean', { timeout: 30_000 }, () => {
  const cleanAll = (answers: unknown[]) =>
    withClient('app_api', async (client) => {
      const { rows } = await client.query<{ clean: boolean }>(
        `SELECT forms.answers_are_clean(a) AS clean
           FROM unnest($1::jsonb[]) WITH ORDINALITY AS t (a, n) ORDER BY n`,
        [answers.map((answer) => JSON.stringify(answer))],
      );
      return rows.map((row) => row.clean);
    });
  const clean = async (answers: unknown) => (await cleanAll([answers]))[0];

  it('refuses blank text at the top level, in a list and in an address', async () => {
    const blanks = [
      '',
      '   ',
      '\t\n',
      '\u200b',
      '\u200c\u200d',
      '\u2060',
      '\ufeff',
      '\u00a0\u3000',
    ];
    const answers = blanks.flatMap((blank) => [
      { f_text: blank },
      { f_choices: ['north', blank] },
      { f_address: { line1: blank, town: 'Leeds', postcode: 'LS1 1AA' } },
    ]);
    const results = await cleanAll(answers);
    answers.forEach((answer, i) => {
      expect(results[i], JSON.stringify(answer)).toBe(false);
    });
    expect(await clean([])).toBe(false);
    expect(await clean('text')).toBe(false);
  });

  it('accepts a clean answer of every engine field type, and null for none', async () => {
    expect(
      await clean({
        f_short: 'A short answer',
        f_long: 'Line one\nLine two',
        f_number: 12.5,
        f_currency: { amountMinor: 125000, currency: 'GBP' },
        f_date: '2027-03-01',
        f_email: 'person@example.test',
        f_phone: '+44 113 496 0000',
        f_url: 'https://example.test',
        f_single: 'north',
        f_dropdown: 'south',
        f_multiple: ['north', 'south'],
        f_yes: true,
        f_address: { line1: '1 Synthetic Street', town: 'Leeds', postcode: 'LS1 1AA' },
        f_table: [
          { c_item: 'Hall hire', c_cost: { amountMinor: 5000, currency: 'GBP' } },
          { c_item: '' },
        ],
        f_file: ['8d3c6f2e-1f4b-4c55-9a77-0d6c2f8b1a10'],
        f_none: null,
        f_empty: [],
      }),
    ).toBe(true);
  });

  it('backs the response check', async () => {
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'forms.response',
        responseRow(tenant, parts, { answers: JSON.stringify({ f_name: '\u200b' }) }),
      ),
    ).toBe('23514');
  });
});

describe('forms.respondent_token', { timeout: 30_000 }, () => {
  it('belongs to a submitted anonymous response, which app_api cannot give one', async () => {
    expect(
      await insertOutcome('app_api', tenant, 'forms.respondent_token', tokenRow(tenant, anonymous)),
    ).toBe('42501');
    expect(
      await insertOutcome('migrator', tenant, 'forms.respondent_token', tokenRow(tenant, response)),
    ).toBe('23514');
  });

  it('ends with its response, and is revoked once at the database time', async () => {
    await asApi(async (client) => {
      const row = await one(
        client,
        `SELECT t.expires_at = r.retain_until AS ends
           FROM forms.respondent_token t JOIN forms.response r ON r.id = t.response_id
          WHERE t.id = $1`,
        [token],
      );
      expect(row?.['ends']).toBe(true);
      expect(
        await outcome(
          client,
          'UPDATE forms.respondent_token SET expires_at = now() WHERE id = $1',
          [token],
        ),
      ).toBe('42501');
      const revoke =
        'UPDATE forms.respondent_token SET revoked_at = $1, revoked_by = $2 WHERE id = $3';
      const revoked = await one(client, `${revoke} RETURNING revoked_at`, [
        '2001-01-01T00:00:00Z',
        parts.member,
        token,
      ]);
      expect((revoked?.['revoked_at'] as Date).getFullYear()).toBeGreaterThan(2001);
      expect(await outcome(client, revoke, [null, null, token])).toBe('23514');
    });
  });
});
