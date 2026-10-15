// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES } from '../files/types.ts';
import { rawUploadRequestBody } from './json-schema.ts';

describe('rawUploadRequestBody', () => {
  it('shows the content type and the limit for the OpenAPI document', () => {
    expect(
      rawUploadRequestBody({ raw: ['application/octet-stream'], maxBytes: MAX_FILE_BYTES }),
    ).toEqual({
      required: true,
      description:
        "The file's bytes, at most 10,485,760 bytes, with its name percent-encoded in the File-Name header.",
      content: {
        'application/octet-stream': {
          schema: {
            type: 'string',
            contentMediaType: 'application/octet-stream',
            'x-max-bytes': MAX_FILE_BYTES,
          },
        },
      },
    });
  });
});
