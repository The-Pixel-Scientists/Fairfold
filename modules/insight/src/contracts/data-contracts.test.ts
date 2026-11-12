// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { dataContractList, dataContractListSchema } from './data-contracts.ts';

describe('the data contracts', () => {
  it('list every slot, version, table and column with its class, from the registry alone', () => {
    const list = dataContractListSchema.parse(dataContractList());
    expect(list.contracts.map(({ module, version }) => [module, version])).toEqual([
      ['party', 1],
      ['grants', 1],
      ['crm', null],
      ['assure', null],
      ['forms', null],
      ['privacy', null],
      ['insight', null],
      ['impact', null],
    ]);
    const grants = list.contracts.find(({ module }) => module === 'grants');
    const programme = grants?.tables.find(({ name }) => name === 'programme');
    expect(programme?.columns.slice(0, 3)).toEqual([
      {
        name: 'id',
        type: 'uuid',
        nullable: false,
        class: 'internal',
        sources: ['grants.programme.id'],
      },
      { name: 'source_module', type: 'text', nullable: false, class: 'internal', sources: [] },
      {
        name: 'title',
        type: 'text',
        nullable: false,
        class: 'public',
        sources: ['grants.programme.title'],
      },
    ]);
  });
});
