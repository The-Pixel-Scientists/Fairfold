// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  evaluate,
  policyProblems,
  unusedExceptions,
  type InstalledPackage,
  type LicenceException,
  type LicencePolicy,
} from './licence-policy.ts';

const policy: LicencePolicy = {
  allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
  allowedPerPackage: ['CC-BY-4.0', 'Python-2.0', 'LGPL-3.0-or-later'],
  denied: ['SSPL-1.0', 'GPL-2.0-only'],
  exceptions: [],
};

function pkg(licence: string, production = true): InstalledPackage {
  return { name: 'example', version: '1.0.0', licence, production };
}

function exception(overrides: Partial<LicenceException> = {}): LicenceException {
  return {
    package: 'example',
    version: '1.0.0',
    licence: 'CC-BY-4.0',
    scope: 'development',
    reason: 'Data file used only in development.',
    approver: 'Aaron Gardner',
    date: '2026-09-28',
    ...overrides,
  };
}

function withException(overrides: Partial<LicenceException> = {}): LicencePolicy {
  return { ...policy, exceptions: [exception(overrides)] };
}

describe('evaluate', () => {
  it('passes an allowed licence', () => {
    expect(evaluate(pkg('MIT'), policy)).toEqual({ ok: true });
  });

  it('passes OR when any branch is allowed', () => {
    expect(evaluate(pkg('(SSPL-1.0 OR MIT)'), policy).ok).toBe(true);
  });

  it('needs every part of AND to be allowed', () => {
    expect(evaluate(pkg('MIT AND BSD-3-Clause'), policy).ok).toBe(true);
    expect(evaluate(pkg('MIT AND CC-BY-4.0'), policy).ok).toBe(false);
  });

  it('fails a denied licence, even with an exception', () => {
    expect(evaluate(pkg('SSPL-1.0'), withException({ licence: 'SSPL-1.0' }))).toEqual({
      ok: false,
      reason: 'example@1.0.0 is under a denied licence (SSPL-1.0)',
    });
    expect(evaluate(pkg('MIT AND GPL-2.0-only'), policy).ok).toBe(false);
  });

  it('reads deprecated ids as their current ones', () => {
    expect(evaluate(pkg('GPL-2.0'), withException({ licence: 'GPL-2.0' }))).toEqual({
      ok: false,
      reason: 'example@1.0.0 is under a denied licence (GPL-2.0-only)',
    });
    expect(evaluate(pkg('GPL-2.0-with-classpath-exception'), policy)).toEqual({
      ok: false,
      reason: 'example@1.0.0 is under a denied licence (GPL-2.0-only WITH Classpath-exception-2.0)',
    });
  });

  it('reads the plus form as "or later"', () => {
    const plus = withException({ licence: 'LGPL-3.0+', scope: 'all' });
    expect(evaluate(pkg('LGPL-3.0+'), plus).ok).toBe(true);
    // GPL-2.0-or-later is not GPL-2.0-only, but it is not allowed either.
    expect(evaluate(pkg('GPL-2.0+'), withException({ licence: 'GPL-2.0+' })).ok).toBe(false);
  });

  it('checks WITH clauses as a whole, and against the deny list', () => {
    expect(evaluate(pkg('Apache-2.0 WITH LLVM-exception'), policy).ok).toBe(false);
    const excepted = withException({ licence: 'Apache-2.0 WITH LLVM-exception' });
    expect(evaluate(pkg('Apache-2.0 WITH LLVM-exception', false), excepted).ok).toBe(false);
    expect(evaluate(pkg('GPL-2.0-only WITH Classpath-exception-2.0'), policy)).toEqual({
      ok: false,
      reason: 'example@1.0.0 is under a denied licence (GPL-2.0-only WITH Classpath-exception-2.0)',
    });
  });

  it('fails unknown, missing, custom and unparseable licences, even with an exception', () => {
    for (const licence of ['Unknown', '', 'SEE LICENSE IN LICENSE.txt', 'LicenseRef-custom']) {
      expect(evaluate(pkg(licence, false), withException({ licence })).ok).toBe(false);
    }
    expect(evaluate(pkg('Apache-2.0 WITH Commons-Clause'), policy).ok).toBe(false);
  });

  it('passes a recorded exception for that exact version and licence', () => {
    expect(evaluate(pkg('CC-BY-4.0', false), withException()).ok).toBe(true);
    expect(evaluate({ ...pkg('CC-BY-4.0', false), version: '1.0.1' }, withException()).ok).toBe(
      false,
    );
    expect(evaluate(pkg('Python-2.0', false), withException()).ok).toBe(false);
  });

  it('passes an exception only for licences ADR 0002 allows per package', () => {
    expect(evaluate(pkg('WTFPL', false), withException({ licence: 'WTFPL' }))).toEqual({
      ok: false,
      reason: 'example@1.0.0 is under WTFPL, which ADR 0002 does not allow even with an exception',
    });
    const mixed = withException({ licence: 'MIT AND Python-2.0' });
    expect(evaluate(pkg('MIT AND Python-2.0', false), mixed).ok).toBe(true);
  });

  it('fails a development-only exception in the production tree', () => {
    expect(evaluate(pkg('CC-BY-4.0', true), withException())).toEqual({
      ok: false,
      reason: 'example@1.0.0 has a development-only exception but is a production dependency',
    });
  });

  it('fails an exception without a reason, approver or date', () => {
    for (const field of ['reason', 'approver', 'date'] as const) {
      expect(evaluate(pkg('CC-BY-4.0', false), withException({ [field]: ' ' })).ok).toBe(false);
    }
  });
});

describe('policyProblems', () => {
  it('reports a licence listed twice', () => {
    expect(policyProblems(policy)).toEqual([]);
    expect(policyProblems({ ...policy, denied: [...policy.denied, 'MIT'] })).toEqual([
      'licence-policy.json lists MIT in both allowed and denied',
    ]);
  });
});

describe('unusedExceptions', () => {
  it('lists exceptions that match no installed package', () => {
    const stale = exception({ version: '0.9.0' });
    const current = exception();
    expect(
      unusedExceptions([pkg('CC-BY-4.0', false)], { ...policy, exceptions: [stale, current] }),
    ).toEqual([stale]);
  });
});
