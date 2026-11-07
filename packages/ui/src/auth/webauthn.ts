// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser's WebAuthn calls, with the JSON forms the API speaks (every
// binary value base64url) turned into and out of the buffers the browser
// wants. No library: `navigator.credentials` does the work. A cancelled
// prompt and a failed one are told apart, and neither changes anything.

/** Binary values travel as base64url text. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

interface DescriptorJSON {
  type: 'public-key';
  id: string;
  transports?: string[] | undefined;
}

export interface CreationOptionsJSON {
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number | undefined;
  excludeCredentials?: DescriptorJSON[] | undefined;
  authenticatorSelection: {
    authenticatorAttachment?: AuthenticatorAttachment | undefined;
    residentKey: ResidentKeyRequirement;
    userVerification: 'required';
  };
  hints?: string[] | undefined;
  attestation: 'none';
  extensions?: { credProps: true } | undefined;
}

export interface RequestOptionsJSON {
  challenge: string;
  timeout?: number | undefined;
  rpId: string;
  allowCredentials?: DescriptorJSON[] | undefined;
  userVerification: 'required';
  hints?: string[] | undefined;
}

interface CredentialJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: { credProps?: { rk?: boolean } };
}

export interface RegistrationJSON extends CredentialJSON {
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData?: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
}

export interface AuthenticationJSON extends CredentialJSON {
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

/**
 * What a ceremony came to. `cancelled` is the person dismissing the prompt or
 * it timing out; `failed` is anything else the browser refused, such as a key
 * that is already registered; `unsupported` is a browser with no WebAuthn.
 */
export type PasskeyResult<T> =
  { status: 'ok'; credential: T } | { status: 'cancelled' | 'failed' | 'unsupported' };

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'PublicKeyCredential' in window &&
    typeof navigator.credentials === 'object' &&
    typeof navigator.credentials.create === 'function'
  );
}

const descriptors = (list: DescriptorJSON[] | undefined): PublicKeyCredentialDescriptor[] =>
  (list ?? []).map(({ id, transports, type }) => ({
    type,
    id: fromBase64url(id),
    ...(transports && { transports: transports as AuthenticatorTransport[] }),
  }));

function common(credential: PublicKeyCredential): CredentialJSON {
  const { credProps } = credential.getClientExtensionResults();
  const { authenticatorAttachment } = credential;
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: 'public-key',
    ...(authenticatorAttachment !== null &&
      (authenticatorAttachment === 'platform' || authenticatorAttachment === 'cross-platform') && {
        authenticatorAttachment,
      }),
    // Only credProps is asked for, so only it is sent back.
    clientExtensionResults: {
      ...(credProps?.rk !== undefined && { credProps: { rk: credProps.rk } }),
    },
  };
}

function resultOf(error: unknown): { status: 'cancelled' | 'failed' } {
  const name = error instanceof DOMException ? error.name : '';
  return { status: name === 'NotAllowedError' || name === 'AbortError' ? 'cancelled' : 'failed' };
}

/** Asks the browser to make a passkey from the server's options. */
export async function createPasskey(
  options: CreationOptionsJSON,
): Promise<PasskeyResult<RegistrationJSON>> {
  if (!passkeysSupported()) return { status: 'unsupported' };
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: options.rp,
        user: { ...options.user, id: fromBase64url(options.user.id) },
        challenge: fromBase64url(options.challenge),
        pubKeyCredParams: options.pubKeyCredParams,
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation,
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(options.excludeCredentials && {
          excludeCredentials: descriptors(options.excludeCredentials),
        }),
        ...(options.hints && { hints: options.hints }),
        ...(options.extensions && { extensions: options.extensions }),
      },
    });
    if (!(credential instanceof PublicKeyCredential)) return { status: 'failed' };
    const { response } = credential;
    if (!(response instanceof AuthenticatorAttestationResponse)) return { status: 'failed' };
    const publicKey = response.getPublicKey();
    return {
      status: 'ok',
      credential: {
        ...common(credential),
        response: {
          clientDataJSON: toBase64url(response.clientDataJSON),
          attestationObject: toBase64url(response.attestationObject),
          authenticatorData: toBase64url(response.getAuthenticatorData()),
          transports: response.getTransports(),
          publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
          ...(publicKey !== null && { publicKey: toBase64url(publicKey) }),
        },
      },
    };
  } catch (error) {
    return resultOf(error);
  }
}

/** Asks the browser to sign the server's challenge with a passkey. */
export async function getPasskeyAssertion(
  options: RequestOptionsJSON,
): Promise<PasskeyResult<AuthenticationJSON>> {
  if (!passkeysSupported()) return { status: 'unsupported' };
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64url(options.challenge),
        rpId: options.rpId,
        userVerification: options.userVerification,
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(options.allowCredentials && {
          allowCredentials: descriptors(options.allowCredentials),
        }),
        ...(options.hints && { hints: options.hints }),
      },
    });
    if (!(credential instanceof PublicKeyCredential)) return { status: 'failed' };
    const { response } = credential;
    if (!(response instanceof AuthenticatorAssertionResponse)) return { status: 'failed' };
    return {
      status: 'ok',
      credential: {
        ...common(credential),
        response: {
          clientDataJSON: toBase64url(response.clientDataJSON),
          authenticatorData: toBase64url(response.authenticatorData),
          signature: toBase64url(response.signature),
          ...(response.userHandle !== null && { userHandle: toBase64url(response.userHandle) }),
        },
      },
    };
  } catch (error) {
    return resultOf(error);
  }
}
