// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { describe, expect, it } from 'vitest';

import { formsMessages } from '../../contracts/index.ts';
import { publishRefusal } from './refusal.ts';

const definition = formDefinitionSchema.parse({
  sections: [
    {
      id: 's_one',
      title: 'One',
      fields: [
        { id: 'f_name', type: 'short_text', label: 'Name' },
        {
          id: 'f_costs',
          type: 'table',
          label: 'Costs',
          rowNoun: 'cost',
          columns: [
            { id: 'c_item', type: 'short_text', label: 'Item' },
            { id: 'c_amount', type: 'number', label: 'Amount' },
          ],
        },
      ],
    },
  ],
});

const refusal = (errors: { field: string; message: string }[]) =>
  new ProblemError(422, 'This form cannot be published.', { errors });

describe('publishRefusal', () => {
  it("places each refusal at the named question, in the server's words", () => {
    expect(
      publishRefusal(
        refusal([
          { field: 'f_name', message: formsMessages.typeChanged },
          { field: 'f_name', message: formsMessages.classificationLowered },
        ]),
        definition,
      ),
    ).toEqual([
      { path: ['sections', 0, 'fields', 0, 'type'], message: formsMessages.typeChanged },
      {
        path: ['sections', 0, 'fields', 0, 'classification'],
        message: formsMessages.classificationLowered,
      },
    ]);
  });

  it('places a refusal for a table column at the column', () => {
    expect(
      publishRefusal(
        refusal([{ field: 'f_costs.c_amount', message: formsMessages.typeChanged }]),
        definition,
      ),
    ).toEqual([
      {
        path: ['sections', 0, 'fields', 1, 'columns', 1, 'type'],
        message: formsMessages.typeChanged,
      },
    ]);
  });

  it('keeps a refusal that names no question of the draft, with no place', () => {
    expect(
      publishRefusal(
        refusal([{ field: 'f_gone', message: formsMessages.anonymousFile }]),
        definition,
      ),
    ).toEqual([{ path: [], message: formsMessages.anonymousFile }]);
    expect(publishRefusal(new ProblemError(500, 'The server stopped.'), definition)).toEqual([
      { path: [], message: 'The server stopped.' },
    ]);
  });
});
