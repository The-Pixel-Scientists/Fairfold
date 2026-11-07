// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { envFile, seedManager, sessionToken, totp } from './manager.ts';

describe('seedManager', () => {
  it("is the seed's synthetic Northfield programme manager", () => {
    expect(seedManager()).toEqual({ slug: 'northfield', email: 'ada.morgan@northfield.example' });
  });
});

describe('totp', () => {
  it("gives RFC 6238's SHA-1 codes", () => {
    // The key "12345678901234567890" of RFC 6238, appendix B, in base32.
    const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // gitleaks:allow
    expect(totp(key, 59_000)).toBe('287082');
    expect(totp(key, 1_111_111_109_000)).toBe('081804');
    expect(totp(key, 20_000_000_000_000)).toBe('353130');
  });
});

describe('sessionToken', () => {
  it("reads the console session from Set-Cookie, and no other cookie's", () => {
    expect(
      sessionToken(['other=1; Path=/', '__Host-tps_console_session=abc.def; Path=/; Secure']),
    ).toBe('abc.def');
    expect(sessionToken(['__Host-tps_portal_session=abc; Path=/'])).toBeUndefined();
    expect(sessionToken(['__Host-tps_console_session=; Max-Age=0'])).toBeUndefined();
    expect(sessionToken()).toBeUndefined();
  });
});

describe('envFile', () => {
  it('writes one line a value', () => {
    expect(envFile({ A: 'x=y', B: 'z' })).toBe('A=x=y\nB=z\n');
  });

  it('refuses a value that is empty or would spill onto another line', () => {
    for (const value of ['', 'a\nB=b', 'a\r']) {
      expect(() => envFile({ A: value }), JSON.stringify(value)).toThrow(
        'A cannot go in an env file.',
      );
    }
  });
});

describe("the CI stack job's patterns for the manager's journeys", () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');
  const lines = read('.github/workflows/ci.yml')
    .split('\n')
    .map((text) => text.trim());
  const setting = (name: string): string => {
    const prefix = `${name}: `;
    const line = lines.find((text) => text.startsWith(prefix));
    if (line === undefined) throw new Error(`ci.yml sets no ${name}.`);
    return line.slice(prefix.length);
  };
  const files = ['apps/console/e2e', 'apps/portal/e2e'].flatMap((folder) =>
    readdirSync(join(root, folder)).map((name) => `${folder}/${name}`),
  );
  const specs = files.filter((file) => file.endsWith('.spec.ts'));
  // A spec signs in as the manager if it, or a helper it imports, reads the manager's settings.
  const helpers = files
    .filter((file) => !specs.includes(file) && read(file).includes('TPS_E2E_MANAGER_'))
    .map((file) => `./${basename(file)}`);
  const signsIn = (spec: string): boolean =>
    ['TPS_E2E_MANAGER_', ...helpers].some((text) => read(spec).includes(text));
  // Each pattern is a spec file name with its dots escaped, which --grep finds anywhere in a test's path.
  const matches = (pattern: string): string[] => {
    expect(pattern).toMatch(/^[a-z-]+(\\\.[a-z]+)+$/);
    const name = pattern.replaceAll('\\.', '.');
    return specs.filter((spec) => spec.includes(name));
  };

  // The parts of the stack job's matrix. Each runs on a stack of its own,
  // filled with one scenario, and runs either a shard of the specs or one
  // list of journeys.
  const parts = lines
    .map((text) =>
      /^- \{ part: '([^']+)', scenario: ([a-z]+), (shard|journeys): (\S+) \}$/.exec(text),
    )
    .filter((found) => found !== null)
    .map(([, part, scenario, kind, value]) => ({ part, scenario, kind, value }));
  /** Whether ci.yml has these lines one after another, indents aside. */
  const runsInTurn = (...expected: string[]): boolean =>
    lines.some((_, start) => expected.every((text, index) => lines[start + index] === text));
  const lists = ['MANAGER_JOURNEYS', 'REVIEW_JOURNEYS', 'PROGRAMME_JOURNEY'];

  it('pick out each spec that signs in as the manager, once, the outcome journey first', () => {
    const runs = lists.flatMap((name) => setting(name).split(' '));
    expect(runs.map(matches)).toEqual([
      ['apps/portal/e2e/outcome-journey.spec.ts'],
      ['apps/console/e2e/form-builder-journey.spec.ts'],
      ['apps/console/e2e/forms-builder-table-file-journey.spec.ts'],
      ['apps/console/e2e/submissions-files-journey.spec.ts'],
      ['apps/console/e2e/submissions-journey.spec.ts'],
      ['apps/console/e2e/assessment-journey.spec.ts'],
      ['apps/console/e2e/decisions-journey.spec.ts'],
      ['apps/console/e2e/programme-journey.spec.ts'],
    ]);
    expect(runs.flatMap(matches).sort()).toEqual(specs.filter(signsIn).sort());
  });

  it('run each list in one part of its own, on the scenario it needs, a file at a time', () => {
    expect(parts.filter(({ kind }) => kind === 'journeys')).toEqual([
      { part: 'manager journeys', scenario: 'configured', kind: 'journeys', value: lists[0] },
      { part: 'review journeys', scenario: 'applications', kind: 'journeys', value: lists[1] },
      { part: 'programme journey', scenario: 'base', kind: 'journeys', value: lists[2] },
    ]);
    expect(lines).toContain('pnpm stack seed "$SCENARIO"');
    expect(
      runsInTurn(
        'for journey in ${!JOURNEYS}; do',
        'sleep $((31 - $(date +%s) % 30))',
        'specs --grep "$journey" --workers 1',
        'done',
      ),
    ).toBe(true);
  });

  it('keep every one of them out of the shards that run the other specs', () => {
    expect(parts.filter(({ kind }) => kind === 'shard')).toEqual(
      ['1/3', '2/3', '3/3'].map((value, index) => ({
        part: `specs, ${String(index + 1)} of 3`,
        scenario: 'configured',
        kind: 'shard',
        value,
      })),
    );
    expect(
      runsInTurn(
        `all="${lists.map((name) => `$${name}`).join(' ')}"`,
        'specs --shard "$SHARD" --grep-invert "${all// /|}"',
      ),
    ).toBe(true);
  });
});
