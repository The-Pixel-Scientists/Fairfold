// SPDX-License-Identifier: AGPL-3.0-or-later

import { crmRoutes } from '@pixel-scientists/crm/contracts';
import { describe, expect, it } from 'vitest';

import { Secret } from '../config.ts';
import { moduleDependencies } from '../modules.ts';
import { crmComposition } from './crm.ts';

const withSecret = moduleDependencies({
  settings: {
    crm: { previewSecret: new Secret('a-test-secret-that-is-at-least-32-bytes') },
    marketing: undefined,
    forms: undefined,
    assure: { registryKeys: {}, sanctionsListUrl: undefined },
  },
});

/** Routes whose handlers wait on another owner: party's unmerge, and the import's file and party reads. */
const unregistered = [
  'reverseMerge',
  'startImport',
  'getImport',
  'listImportRows',
  'confirmImport',
] as const;

const names = (composition: ReturnType<typeof crmComposition>) =>
  (composition.routes ?? []).map(({ contract }) => `${contract.method} ${contract.path}`).sort();

describe('the crm composition', () => {
  it('registers every crm route that has a handler, and no other', () => {
    const wanted = Object.entries(crmRoutes)
      .filter(([name]) => !(unregistered as readonly string[]).includes(name))
      .map(([, { method, path }]) => `${method} ${path}`)
      .sort();

    expect(names(crmComposition(withSecret))).toEqual(wanted);
  });

  it('leaves out the merge routes that sign a preview when no secret is set', () => {
    const composition = crmComposition(moduleDependencies({}));

    expect(names(composition)).not.toContain('POST /console/crm/merges/preview');
    expect(names(composition)).not.toContain('POST /console/crm/merges');
    expect(names(composition)).toContain('GET /console/crm/merges/:mergeRecordId');
  });

  it('contributes crm to erasure whether or not a tenant has it on', () => {
    expect(crmComposition(withSecret).erasure?.map(({ module }) => module)).toEqual(['crm']);
  });

  it('supplies nothing the platform does not read yet', () => {
    const composition = crmComposition(withSecret);

    expect(composition.subjectData).toBeUndefined();
    expect(composition.repoints).toBeUndefined();
    expect(composition.subjectRules).toBeUndefined();
  });
});
