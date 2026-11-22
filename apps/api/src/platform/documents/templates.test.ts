// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { checkTemplateFields, templateVersionSchema } from '@pixel-scientists/domain/documents';
import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BOARD_PACK } from './templates.ts';

describe('the built-in board pack', () => {
  it('is a valid staff template that names no question', () => {
    const version = {
      ...DEFAULT_BOARD_PACK,
      id: randomUUID(),
      templateId: randomUUID(),
      version: 1,
    };
    expect(templateVersionSchema.safeParse(version).success).toBe(true);
    expect(checkTemplateFields(version, [])).toEqual([]);
    expect(version.mergeFields).toEqual([]);
  });

  it('has a first-publish diff that the configuration format accepts', () => {
    const diff = [
      { field: 'version', from: null, to: 1 },
      { field: 'kind', from: null, to: 'board_pack' },
      { field: 'audience', from: null, to: 'staff' },
      { field: 'mergeFields', added: [], removed: [] },
    ];
    expect(configDiffSchemas['platform.document_template'].safeParse(diff).success).toBe(true);
  });
});
