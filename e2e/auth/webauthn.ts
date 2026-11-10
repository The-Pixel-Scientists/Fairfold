// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A Chromium virtual authenticator, and the passkey ceremonies run inside the
// page the way the browser runs them for the apps: the API's options, then
// `navigator.credentials`, then the API's check. The console has screens for
// adding and removing a passkey; signing in with one is driven here, in the
// page that holds the authenticator, because a virtual authenticator belongs
// to the page it was added to.

import type { Page } from '@playwright/test';

export interface Authenticator {
  /** Whether the next ceremonies are verified by the user (a fingerprint or a screen lock). */
  verifyUser: (verified: boolean) => Promise<void>;
  /** Removes the authenticator and its credentials. */
  remove: () => Promise<void>;
}

/** CTAP2, internal, with resident keys and user verification on. */
export async function addAuthenticator(page: Page): Promise<Authenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    verifyUser: async (verified) => {
      await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: verified });
    },
    remove: async () => {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      await cdp.send('WebAuthn.disable');
      await cdp.detach();
    },
  };
}

export interface Reply {
  status: number;
  json: unknown;
}

/** A JSON POST to the API from inside the page, with the page's cookies and origin. */
export function postInPage(page: Page, path: string, body: unknown = {}): Promise<Reply> {
  return page.evaluate(
    async ({ path: to, body: sent }) => {
      const response = await fetch(`/api${to}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sent),
      });
      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    },
    { path, body },
  );
}

export interface Ceremony {
  /** The route that answers the options. */
  optionsPath: string;
  /** The route that checks the credential. */
  finishPath: string;
  /** Sent with the credential to the finish route, such as the passkey's name. */
  finishBody?: Record<string, unknown>;
}

export interface CeremonyReply extends Reply {
  /** `options` when the options were refused, `browser` when the authenticator refused, else `finish`. */
  stage: 'options' | 'browser' | 'finish';
}

/** Gets a passkey's assertion for the options at `ceremony.optionsPath`, and sends it to the finish route. */
export function signWithPasskey(page: Page, ceremony: Ceremony): Promise<CeremonyReply> {
  return page.evaluate(async ({ optionsPath, finishPath, finishBody }) => {
    const bytes = (text: string) => {
      const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
      const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    };
    const text = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(answer);
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    };

    const asked = await post(optionsPath, {});
    if (asked.status !== 200) return { stage: 'options' as const, ...asked };
    const options = asked.json as {
      challenge: string;
      rpId: string;
      userVerification: UserVerificationRequirement;
      allowCredentials?: { type: 'public-key'; id: string }[];
    };
    let credential: PublicKeyCredential | null;
    try {
      credential = (await navigator.credentials.get({
        publicKey: {
          challenge: bytes(options.challenge),
          rpId: options.rpId,
          userVerification: options.userVerification,
          allowCredentials: (options.allowCredentials ?? []).map((allowed) => ({
            type: allowed.type,
            id: bytes(allowed.id),
          })),
        },
      })) as PublicKeyCredential | null;
    } catch {
      return { stage: 'browser' as const, status: 0, json: undefined };
    }
    if (credential === null) return { stage: 'browser' as const, status: 0, json: undefined };
    const response = credential.response as AuthenticatorAssertionResponse;
    const answer = await post(finishPath, {
      ...finishBody,
      credential: {
        id: credential.id,
        rawId: text(credential.rawId),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: text(response.clientDataJSON),
          authenticatorData: text(response.authenticatorData),
          signature: text(response.signature),
          ...(response.userHandle === null ? {} : { userHandle: text(response.userHandle) }),
        },
      },
    });
    return { stage: 'finish' as const, ...answer };
  }, ceremony);
}
