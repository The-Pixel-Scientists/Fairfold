// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { LOGO_MAX_BYTES } from '../logo.ts';
import { messages } from '../messages.ts';
import {
  logoUploadSchema,
  moduleStateSchema,
  settingsSchema,
  tenantNameSchema,
  themeChangeSchema,
  timeZones,
} from './schemas.ts';

const settings = { name: 'Northfield Trust', timeZone: 'Europe/London', fiscalYearStartMonth: 4 };

/** Base64 of `bytes` zero bytes, built without Node.js or DOM APIs. */
function base64Of(bytes: number): string {
  const whole = 'A'.repeat(Math.floor(bytes / 3) * 4);
  const rest = bytes % 3;
  return rest === 0 ? whole : `${whole}${rest === 1 ? 'AA==' : 'AAA='}`;
}

describe('settingsSchema', () => {
  it('takes a name, a known IANA time zone and a month', () => {
    expect(timeZones).toContain('Europe/London');
    expect(settingsSchema.parse({ ...settings, name: '  Northfield Trust ' })).toEqual(settings);
  });

  it('refuses an unknown zone, a month outside 1 to 12, a blank name and other keys', () => {
    for (const change of [
      { timeZone: 'Europe/Narnia' },
      { timeZone: 'europe/london' },
      { timeZone: '+01:00' },
      { fiscalYearStartMonth: 0 },
      { fiscalYearStartMonth: 13 },
      { fiscalYearStartMonth: 4.5 },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { tenantId: '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90' },
    ]) {
      expect(
        settingsSchema.safeParse({ ...settings, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });
});

describe('tenantNameSchema', () => {
  it('takes names in any script, with punctuation and symbols', () => {
    for (const name of [
      'Northfield Trust',
      "St Mary's & St John's",
      'Ymddiriedolaeth Gŵyr',
      'Fondation Élan 2026',
      '東京財団',
    ]) {
      expect(tenantNameSchema.parse(name)).toBe(name);
    }
  });

  it('refuses line breaks, NUL, bidi overrides and other hidden characters', () => {
    for (const name of [
      'Evil\r\nBcc: x@y',
      'North\nfield',
      '\u0000x',
      'North\u0000field',
      '\u202ETrust',
      'Trust\u2066x\u2069',
      'North\u200Bfield',
      'North\u2028field',
      'North\u2029field',
      'North\uD800field',
      'North\u007Ffield',
    ]) {
      const result = tenantNameSchema.safeParse(name);
      expect(result.error?.issues[0]?.message, JSON.stringify(name)).toBe(
        messages.tenantNameHidden,
      );
    }
  });

  it('refuses a name with no letter or number', () => {
    for (const name of ['\u200B', '\uFEFF\u200B', '---', '!!!']) {
      const result = tenantNameSchema.safeParse(name);
      expect(result.success, JSON.stringify(name)).toBe(false);
    }
    expect(tenantNameSchema.safeParse('---').error?.issues[0]?.message).toBe(
      messages.tenantNameVisible,
    );
  });

  it('is the rule settingsSchema applies to the name', () => {
    expect(settingsSchema.safeParse({ ...settings, name: 'Evil\r\nBcc: x@y' }).success).toBe(false);
  });
});

describe('themeChangeSchema', () => {
  it('takes a brand colour that passes contrast and a preset, and nothing else', () => {
    expect(themeChangeSchema.parse({ brandColour: '#1F4BB8', preset: 'square' })).toEqual({
      brandColour: '#1f4bb8',
      preset: 'square',
    });
    for (const theme of [
      { brandColour: '#ffff00', preset: 'square' },
      { brandColour: '#1f4bb8', preset: 'bold' },
      { brandColour: '#1f4bb8', preset: 'square', logoType: 'image/svg+xml' },
    ]) {
      expect(themeChangeSchema.safeParse(theme).success).toBe(false);
    }
  });
});

describe('logoUploadSchema', () => {
  it('takes base64 of up to LOGO_MAX_BYTES once decoded', () => {
    for (const bytes of [1, 2, 3, LOGO_MAX_BYTES - 1, LOGO_MAX_BYTES]) {
      expect(logoUploadSchema.safeParse({ data: base64Of(bytes) }).success, String(bytes)).toBe(
        true,
      );
    }
  });

  it('refuses more bytes, with the catalogue message, and text that is not base64', () => {
    for (const data of [base64Of(LOGO_MAX_BYTES + 1), base64Of(LOGO_MAX_BYTES + 3)]) {
      const result = logoUploadSchema.safeParse({ data });
      expect(result.error?.issues[0]?.message).toBe(messages.logoTooLarge);
    }
    for (const data of ['not base64!', 'QUJD\n', 'data:image/png;base64,QUJD']) {
      expect(logoUploadSchema.safeParse({ data }).success).toBe(false);
    }
  });
});

describe('moduleStateSchema', () => {
  it('switches only a switchable module', () => {
    expect(moduleStateSchema.safeParse({ module: 'grants', enabled: false }).success).toBe(true);
    for (const module of ['platform', 'party', 'finance']) {
      expect(moduleStateSchema.safeParse({ module, enabled: false }).success).toBe(false);
    }
  });
});
