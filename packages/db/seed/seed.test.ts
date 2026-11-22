// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed command's output on every refusal, which never holds the
// password, and the scenarios' data, without a database. guard.test.ts
// checks the guard and the password, and seed.integration.test.ts writes
// the scenarios.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  checkEligibility,
  parseDefinition,
  questionsOf,
  validateAnswers,
} from '@pixel-scientists/domain/forms';
import {
  brandColourSchema,
  defaultTheme,
  permissionsFor,
  slugSchema,
} from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { applications } from './applications.ts';
import { base } from './base.ts';
import { communitySpacesForm, configured } from './configured.ts';
import { applicantEmailOf, applicationsOf, emailOf, hashPassword } from './scenario.ts';
import { SCENARIOS } from './seed.ts';

const development = {
  TPS_DEV: '1',
  TPS_DB_HOST: '127.0.0.1',
  TPS_DB_PORT: '5432',
  TPS_DB_NAME: 'tps_w',
  TPS_DEV_DATABASES: 'tps_w,tps_w_test',
};

/** Settings that name staging's database (guard.test.ts reads its name from the services root). */
const staging = {
  TPS_SEED_MODE: 'staging',
  TPS_DB_HOST: '192.0.2.10',
  TPS_DB_PORT: '5432',
  TPS_DB_NAME: 'tps',
  TPS_DB_TLS: 'verify-full',
};

describe('hashPassword', () => {
  it('writes the PHC form auth.account accepts, with a new salt each time', () => {
    const first = hashPassword('a long synthetic passphrase');
    // The check on auth.account.password (migration 0004).
    expect(first).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$/,
    );
    expect(hashPassword('a long synthetic passphrase')).not.toBe(first);
  });
});

describe('the scenarios', () => {
  it('are the ones the seed command names, in order', () => {
    expect([...SCENARIOS.keys()]).toEqual([
      'base',
      'configured',
      'applications',
      'volume',
      'wave1',
    ]);
  });

  it('give each tenant an administrator, a programme manager and two reviewers', () => {
    expect(base.map(({ slug, name }) => [slug, name])).toEqual([
      ['northfield', 'Northfield Community Trust'],
      ['eastmoor', 'Eastmoor Foundation'],
    ]);
    for (const tenant of base) {
      expect(slugSchema.safeParse(tenant.slug).success).toBe(true);
      expect(tenantNameSchema.safeParse(tenant.name).success).toBe(true);
      expect(tenant.staff.map((member) => member[2])).toEqual([
        'tenant_admin',
        'programme_manager',
        'reviewer',
        'reviewer',
      ]);
    }
  });

  it('use only .example addresses, each once', () => {
    const emails = base.flatMap((tenant) => tenant.staff.map((member) => emailOf(tenant, member)));
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toMatch(/^[a-z]+\.[a-z]+@[a-z]+\.example$/);
  });

  it('give Eastmoor a brand colour of its own that passes contrast, and Northfield the default look', () => {
    const [northfield, eastmoor] = base;
    expect(northfield?.theme).toBeUndefined();
    const colour = eastmoor?.theme?.brandColour ?? '';
    expect(brandColourSchema.safeParse(colour).success).toBe(true);
    expect(colour).not.toBe(defaultTheme.brandColour);
  });

  it('configure only Northfield, on top of base', () => {
    expect(configured.map((tenant) => ({ ...tenant, programmes: undefined }))).toEqual(base);
    expect(configured.map((tenant) => tenant.programmes?.map(({ title }) => title))).toEqual([
      ['Community Spaces Fund'],
      undefined,
    ]);
  });
});

describe("the Community Spaces Fund's form", () => {
  const parsed = parseDefinition(communitySpacesForm);

  it('is a valid form, with a required budget table and an optional accounts file', () => {
    expect(parsed.error).toBeUndefined();
    const questions = parsed.data ? questionsOf(parsed.data) : [];
    expect(questions.map(({ id, type, required }) => [id, type, required])).toEqual([
      ['f_local', 'yes_no', true],
      ['f_title', 'short_text', true],
      ['f_summary', 'long_text', true],
      ['f_amount', 'currency', true],
      ['f_budget', 'table', true],
      ['f_accounts', 'file', false],
    ]);
    expect(questions.find(({ id }) => id === 'f_budget')).toMatchObject({
      rowNoun: 'cost',
      minRows: 1,
      columns: [
        { id: 'c_item', type: 'short_text', label: 'Item', total: false },
        { id: 'c_cost', type: 'currency', label: 'Cost', total: true },
      ],
    });
    expect(questions.find(({ id }) => id === 'f_accounts')).toMatchObject({
      label: 'Your latest annual accounts',
      allowedTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
      ],
      maxBytes: 10_485_760,
      maxFiles: 1,
    });
  });

  it("is the published version of configured's round", () => {
    const [northfield] = configured;
    expect(northfield?.programmes?.[0]?.rounds[0]?.form).toBe(communitySpacesForm);
  });
});

describe('the applications scenario', () => {
  const [northfield, eastmoor] = applications;
  const round = northfield?.programmes?.[0]?.rounds[0];
  const submitted = northfield ? applicationsOf(northfield) : [];

  it('is configured, with a round that has closed, a pool and six applications in it', () => {
    expect(eastmoor).toBe(configured[1]);
    const configuredRound = configured[0]?.programmes?.[0]?.rounds[0];
    expect({
      ...round,
      opensAt: '',
      closesAt: '',
      reviewers: undefined,
      applications: [],
    }).toEqual({
      ...configuredRound,
      opensAt: '',
      closesAt: '',
      applications: [],
    });
    expect([round?.opensAt, round?.closesAt]).toEqual(['2026-09-07T09:00', '2026-10-05T17:00']);
    expect(submitted).toHaveLength(6);
  });

  it('has applications in each stage, one of them late and one withdrawn', () => {
    const closesAt = round?.closesAt ?? '';
    expect(submitted.map(({ stage }) => stage).sort()).toEqual([
      'Decision',
      'Intake',
      'Intake',
      'Intake',
      'Review',
      'Review',
    ]);
    expect(submitted.filter(({ submittedAt }) => submittedAt > closesAt)).toHaveLength(1);
    expect(submitted.filter(({ withdrawnAt }) => withdrawnAt !== undefined)).toHaveLength(1);
    for (const { startedAt, submittedAt, withdrawnAt } of submitted) {
      expect(startedAt >= (round?.opensAt ?? '')).toBe(true);
      expect(submittedAt > startedAt).toBe(true);
      if (withdrawnAt !== undefined) expect(withdrawnAt > submittedAt).toBe(true);
    }
  });

  it('answers the form in full, budget table included, and passes its eligibility check', () => {
    const form = parseDefinition(round?.form).data;
    if (!form) throw new Error('The round has no valid form.');
    for (const { answers } of submitted) {
      expect(validateAnswers(form, answers, 'submit')).toEqual([]);
      expect(checkEligibility(form, answers)).toEqual({ status: 'eligible' });
      expect(answers).toHaveProperty('f_budget.0.c_item');
    }
  });

  it("pools Northfield's two reviewers, who review each application in Review", () => {
    const reviewers = (northfield?.staff ?? [])
      .filter(([, , role]) => permissionsFor([role], 'console').includes('grants.reviews.score'))
      .map(([givenName, familyName]) => [givenName, familyName]);
    expect(round?.reviewers).toEqual(reviewers);
    const criteria = round?.stages.find(({ name }) => name === 'Review')?.criteria ?? [];
    for (const { stage, reviews = [] } of submitted) {
      expect(reviews.map(({ reviewer }) => reviewer)).toEqual(stage === 'Review' ? reviewers : []);
      for (const { scores, submitted: done } of reviews) {
        if (done) expect(scores).toHaveLength(criteria.length);
        else expect(scores.length).toBeLessThan(criteria.length);
        for (const [score, comment] of scores) {
          expect(score).toBeGreaterThanOrEqual(1);
          expect(score).toBeLessThanOrEqual(5);
          expect(comment.length).toBeLessThanOrEqual(2000);
        }
      }
    }
    const reviews = submitted.flatMap(({ reviews = [] }) => reviews);
    expect(reviews.filter(({ submitted: done }) => done)).toHaveLength(1);
    expect(reviews.filter(({ scores }) => scores.length > 0)).toHaveLength(3);
  });

  it('records an award within the range and a decline, on submissions that were not withdrawn', () => {
    const decided = submitted.filter(({ decision }) => decision !== undefined);
    expect(
      decided.map(({ organisation, stage, decision }) => [organisation.name, stage, decision]),
    ).toEqual([
      ['Brook Street Youth Club', 'Intake', { outcome: 'declined' }],
      ['Friends of Elm Park', 'Decision', { outcome: 'accepted', amountMinor: 18_000_00 }],
    ]);
    for (const { withdrawnAt } of decided) expect(withdrawnAt).toBeUndefined();
    const award = decided.flatMap(({ decision }) =>
      decision?.outcome === 'accepted' ? [decision.amountMinor] : [],
    );
    for (const amount of award) {
      expect(amount).toBeGreaterThanOrEqual(round?.awardMinMinor ?? Infinity);
      expect(amount).toBeLessThanOrEqual(round?.awardMaxMinor ?? 0);
    }
  });

  it('gives each applicant an .example address of their own', () => {
    if (!northfield) throw new Error('The scenario has no Northfield.');
    const emails = submitted.map(({ applicant }) => applicantEmailOf(northfield, applicant));
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails)
      expect(email).toMatch(/^[a-z]+\.[a-z]+@applicants\.northfield\.example$/);
  });
});

describe('the seed command', { timeout: 600_000 }, () => {
  const script = fileURLToPath(new URL('./seed.ts', import.meta.url));
  const secret = 'a seed password only this test knows';

  /** Run the seed with only `env`, as a refusal must end: before any connection. */
  function run(env: Record<string, string | undefined>, args: readonly string[] = []) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { SystemRoot: process.env['SystemRoot'], TPS_SEED_PASSWORD: secret, ...env },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('prints the failed check and never the password, on every refusal', () => {
    const refusals: [Record<string, string | undefined>, string][] = [
      [staging, 'the seed runs only in development'],
      [{ ...development, TPS_DEV: undefined }, 'the seed runs only in development'],
      [{ ...development, TPS_DB_HOST: '192.0.2.10' }, 'only against a server on this machine'],
      [{ ...development, TPS_DB_NAME: staging.TPS_DB_NAME }, "not this worktree's"],
      [{ ...development, TPS_SEED_PASSWORD: 'short' }, 'must be 12 to 256 characters'],
      [development, 'Set TPS_DB_MIGRATOR_PASSWORD'],
    ];
    for (const [env, message] of refusals) {
      const { status, output } = run(env);
      expect(status, message).toBe(1);
      expect(output).toContain(message);
      expect(output).not.toContain(env['TPS_SEED_PASSWORD'] ?? secret);
      if (env === staging) expect(output).not.toContain(staging.TPS_DB_HOST);
    }
    expect(run(development, ['nonsense']).output).toContain('Name one scenario');
  });
});
