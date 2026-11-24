// SPDX-License-Identifier: AGPL-3.0-or-later

import { privacyRoutes } from '@pixel-scientists/privacy/contracts';
import { describe, expect, it } from 'vitest';

import { moduleDependencies } from '../modules.ts';
import { privacyComposition } from './privacy.ts';

/** Routes whose wiring waits on a piece another owner holds. */
const unregistered = ['startRequestExport', 'getRequestExport', 'getConsentHistory'] as const;

const composition = privacyComposition(moduleDependencies({}));
const names = (composition.routes ?? []).map(
  ({ contract }) => `${contract.method} ${contract.path}`,
);

describe('the privacy composition', () => {
  it('registers every privacy route that has what it needs, and no other', () => {
    const wanted = Object.entries(privacyRoutes)
      .filter(([name]) => !(unregistered as readonly string[]).includes(name))
      .map(([, { method, path }]) => `${method} ${path}`);

    expect(names.sort()).toEqual(wanted.sort());
  });

  it('gives each idempotent route a replay and no other', () => {
    for (const { contract, replay } of composition.routes ?? []) {
      const idempotent = (contract as { idempotent?: true }).idempotent === true;
      expect(replay !== undefined, contract.path).toBe(idempotent);
    }
  });

  it('puts every route behind a privacy permission, for staff in the console', () => {
    for (const { contract } of composition.routes ?? []) {
      expect(contract.audience).toBe('console');
      expect(contract.module).toBe('privacy');
      expect(contract.permission, contract.path).toMatch(/^privacy\./);
    }
  });

  it('asks for a recent sign-in before an erasure starts', () => {
    const start = composition.routes?.find(({ contract }) =>
      contract.path.endsWith('/erasure'),
    )?.contract;

    expect(start).toMatchObject({ method: 'POST', stepUp: true });
  });

  it('contributes privacy to erasure whether or not a tenant has it on', () => {
    expect(composition.erasure?.map(({ module }) => module)).toEqual(['privacy']);
  });

  it('supplies nothing the platform does not read yet', () => {
    expect(composition.subjectData).toBeUndefined();
    expect(composition.repoints).toBeUndefined();
    expect(composition.subjectRules).toBeUndefined();
  });
});
