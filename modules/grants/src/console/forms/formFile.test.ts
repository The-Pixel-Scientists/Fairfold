// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readFormFile } from './formFile.ts';

const file = (content: string) => new File([content], 'form.json', { type: 'application/json' });

const definition = {
  sections: [
    { id: 's_one', title: 'About you', fields: [{ id: 'f_a', type: 'short_text', label: 'Name' }] },
  ],
};

const asFile = (changes: object = {}) =>
  JSON.stringify({ format: 'form-definition', formatVersion: 1, definition, ...changes });

describe('reading a form file', () => {
  it('gives the definition, checked and with its defaults written out', async () => {
    const result = await readFormFile(file(asFile()));

    expect(result).toMatchObject({
      definition: { sections: [{ id: 's_one', fields: [{ id: 'f_a', required: false }] }] },
    });
  });

  it('refuses text that is not JSON, and JSON that is not a form file', async () => {
    const notAForm = 'This file is not a form. Choose a form file that was saved from this tool.';

    expect(await readFormFile(file('sections: nope'))).toEqual({ messages: [notAForm] });
    expect(await readFormFile(file('[]'))).toEqual({ messages: [notAForm] });
    expect(await readFormFile(file(asFile({ format: 'something-else' })))).toEqual({
      messages: [notAForm],
    });
  });

  it('says where each problem in the definition is, with the same checks as the server', async () => {
    const result = await readFormFile(
      file(
        asFile({
          definition: {
            sections: [
              {
                id: 's_one',
                title: 'About you',
                fields: [
                  { id: 'f_a', type: 'short_text', label: 'Name' },
                  { id: 'f_b', type: 'short_text', label: '' },
                ],
              },
            ],
          },
        }),
      ),
    );

    expect(result).toEqual({
      messages: ['Section 1, question 2: Enter at least 1 character.'],
    });
  });

  it('refuses a file that is far larger than a form may be, without reading it', async () => {
    const big = new File(['x'.repeat(600 * 1024)], 'form.json');

    expect(await readFormFile(big)).toEqual({
      messages: [
        'This form is larger than 256 KB. Remove questions or shorten text to make it smaller.',
      ],
    });
  });
});
