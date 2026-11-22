// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../../config.ts';
import { loadEsignSettings } from './settings.ts';

describe('the e-signature settings', () => {
  it('leave signing off when no provider is named', () => {
    expect(loadEsignSettings({})).toEqual({ provider: null });
    expect(loadEsignSettings({ TPS_ESIGN_PROVIDER: '' })).toEqual({ provider: null });
  });

  it('take the fake provider in development only', () => {
    expect(loadEsignSettings({ TPS_ESIGN_PROVIDER: 'fake', TPS_DEV: '1' })).toEqual({
      provider: 'fake',
    });
    for (const env of [
      { TPS_ESIGN_PROVIDER: 'fake' },
      { TPS_ESIGN_PROVIDER: 'fake', TPS_DEV: '0' },
    ]) {
      expect(() => loadEsignSettings(env)).toThrow(ConfigError);
      expect(() => loadEsignSettings(env)).toThrow(/TPS_DEV=1/);
    }
  });

  it('refuse a provider that has no adapter', () => {
    expect(() => loadEsignSettings({ TPS_ESIGN_PROVIDER: 'docuseal', TPS_DEV: '1' })).toThrow(
      /must be one of: fake/,
    );
  });
});
