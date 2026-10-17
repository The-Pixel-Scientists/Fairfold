// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed's guard and password, and the scenarios' data, without a
// database. seed.integration.test.ts writes the scenarios.

import {
  checkEligibility,
  parseDefinition,
  questionsOf,
  validateAnswers,
} from '@pixel-scientists/domain/forms';
import { brandColourSchema, defaultTheme, slugSchema } from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { applications } from './applications.ts';
import { base } from './base.ts';
import { communitySpacesForm, configured } from './configured.ts';
import { applicantEmailOf, applicationsOf, emailOf, hashPassword } from './scenario.ts';
import { checkTarget, readSeedPassword } from './seed.ts';

describe('checkTarget', () => {
  const env = {
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DB_NAME: 'tps_w',
    TPS_DEV_DATABASES: 'tps_w,tps_w_test',
  };

  it("allows this worktree's development database and the stack's", () => {
    expect(checkTarget(env)).toBe('tps_w');
    expect(checkTarget({ ...env, TPS_DB_HOST: '::1' })).toBe('tps_w');
    expect(checkTarget({ ...env, TPS_DB_NAME: 'tps', TPS_DEV_DATABASES: 'tps' })).toBe('tps');
  });

  it('refuses outside development', () => {
    expect(() => checkTarget({ ...env, TPS_DEV: undefined })).toThrow(
      'Refusing to seed tps_w: the seed runs only in development (TPS_DEV=1).',
    );
  });

  it('refuses a server on another machine', () => {
    for (const host of ['db.example.org', '10.0.0.5', '192.0.2.1']) {
      expect(() => checkTarget({ ...env, TPS_DB_HOST: host })).toThrow(
        `Refusing to seed a database on ${host}: the seed runs only against a server on this machine.`,
      );
    }
  });

  it("refuses another worktree's database, or any when the list is empty", () => {
    for (const other of [
      { TPS_DB_NAME: 'tps_other' },
      { TPS_DEV_DATABASES: '' },
      { TPS_DEV_DATABASES: undefined },
    ]) {
      expect(() => checkTarget({ ...env, ...other })).toThrow("it is not this worktree's");
    }
  });

  it("refuses this worktree's test database", () => {
    expect(() => checkTarget({ ...env, TPS_DB_NAME: 'tps_w_test' })).toThrow(
      'Refusing to seed tps_w_test: it is a test database.',
    );
  });
});

describe('readSeedPassword', () => {
  it('takes a password the API would accept, without ever showing it', () => {
    expect(readSeedPassword({ TPS_SEED_PASSWORD: 'a long synthetic passphrase' })).toBe(
      'a long synthetic passphrase',
    );
    for (const password of ['too short', 'x'.repeat(257)]) {
      expect(() => readSeedPassword({ TPS_SEED_PASSWORD: password })).toThrow(
        'The seed password must be 12 to 256 characters.',
      );
    }
    expect(() => readSeedPassword({})).toThrow('Set TPS_SEED_PASSWORD or TPS_SEED_PASSWORD_FILE.');
  });
});

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

  it('is configured, with a round that has closed and six applications in it', () => {
    expect(eastmoor).toBe(configured[1]);
    const configuredRound = configured[0]?.programmes?.[0]?.rounds[0];
    expect({ ...round, opensAt: '', closesAt: '', applications: [] }).toEqual({
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

  it('gives each applicant an .example address of their own', () => {
    if (!northfield) throw new Error('The scenario has no Northfield.');
    const emails = submitted.map(({ applicant }) => applicantEmailOf(northfield, applicant));
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails)
      expect(email).toMatch(/^[a-z]+\.[a-z]+@applicants\.northfield\.example$/);
  });
});
