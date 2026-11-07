// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPasskey,
  fromBase64url,
  getPasskeyAssertion,
  passkeysSupported,
  toBase64url,
} from './webauthn.ts';
import type { CreationOptionsJSON } from './webauthn.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;

class FakeAttestation {
  clientDataJSON = buffer(1, 2);
  attestationObject = buffer(3, 4);
  getAuthenticatorData = () => buffer(5);
  getTransports = () => ['internal'];
  getPublicKeyAlgorithm = () => -7;
  getPublicKey = () => buffer(6);
}

class FakeAssertion {
  clientDataJSON = buffer(1);
  authenticatorData = buffer(2);
  signature = buffer(3);
  userHandle = null;
}

class FakeCredential {
  id = 'abc';
  rawId = buffer(251, 255);
  authenticatorAttachment = 'platform';
  response: unknown;
  constructor(response: unknown) {
    this.response = response;
  }
  getClientExtensionResults = () => ({ credProps: { rk: true }, other: 'dropped' });
}

const options: CreationOptionsJSON = {
  rp: { id: 'example.org', name: 'Example' },
  user: { id: 'AQI', name: 'ada', displayName: 'Ada' },
  challenge: 'AAEC',
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  attestation: 'none',
};

function stubBrowser(create: () => Promise<unknown>, get = create) {
  vi.stubGlobal('PublicKeyCredential', FakeCredential);
  vi.stubGlobal('AuthenticatorAttestationResponse', FakeAttestation);
  vi.stubGlobal('AuthenticatorAssertionResponse', FakeAssertion);
  vi.stubGlobal('navigator', { credentials: { create: vi.fn(create), get: vi.fn(get) } });
}

describe('base64url', () => {
  it('round-trips bytes, with no padding and a url-safe alphabet', () => {
    expect(toBase64url(buffer(251, 255, 254))).toBe('-__-');
    expect([...fromBase64url('-__-')]).toEqual([251, 255, 254]);
    expect([...fromBase64url('AQI')]).toEqual([1, 2]);
  });
});

describe('createPasskey', () => {
  it('says unsupported when the browser has no WebAuthn', async () => {
    vi.stubGlobal('navigator', {});
    expect(passkeysSupported()).toBe(false);
    expect(await createPasskey(options)).toEqual({ status: 'unsupported' });
  });

  it('turns the browser credential into the API form, keeping only credProps', async () => {
    stubBrowser(() => Promise.resolve(new FakeCredential(new FakeAttestation())));

    const result = await createPasskey(options);

    expect(result).toEqual({
      status: 'ok',
      credential: {
        id: 'abc',
        rawId: '-_8',
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: 'AQI',
          attestationObject: 'AwQ',
          authenticatorData: 'BQ',
          transports: ['internal'],
          publicKeyAlgorithm: -7,
          publicKey: 'Bg',
        },
      },
    });
  });

  it('tells a dismissed prompt from a failure', async () => {
    stubBrowser(() => Promise.reject(new DOMException('No.', 'NotAllowedError')));
    expect(await createPasskey(options)).toEqual({ status: 'cancelled' });

    stubBrowser(() => Promise.reject(new DOMException('Already.', 'InvalidStateError')));
    expect(await createPasskey(options)).toEqual({ status: 'failed' });
  });
});

describe('getPasskeyAssertion', () => {
  it('signs a challenge and leaves out an absent user handle', async () => {
    stubBrowser(() => Promise.resolve(new FakeCredential(new FakeAssertion())));

    const result = await getPasskeyAssertion({
      challenge: 'AAEC',
      rpId: 'example.org',
      userVerification: 'required',
    });

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.credential.response).toEqual({
      clientDataJSON: 'AQ',
      authenticatorData: 'Ag',
      signature: 'Aw',
    });
  });

  it('says cancelled when the person dismisses the prompt', async () => {
    stubBrowser(() => Promise.reject(new DOMException('No.', 'NotAllowedError')));
    expect(
      await getPasskeyAssertion({ challenge: 'AAEC', rpId: 'a.org', userVerification: 'required' }),
    ).toEqual({ status: 'cancelled' });
  });
});
