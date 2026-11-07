// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The WebAuthn Level 3 JSON forms the passkey routes carry: the options the
// server answers, and the browser's credential it checks. Only the fields
// the specification defines; every binary value is base64url, every string
// and list has a limit, and no object takes a key it does not name.

import { z } from 'zod';

const b64url = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/** A credential id is at most 1,023 bytes (WebAuthn Level 3, 5.1). */
const credentialId = b64url(1366);
const transports = z
  .array(
    z
      .string()
      .max(16)
      .regex(/^[a-z-]+$/),
  )
  .max(8)
  .optional();
const attachment = z.enum(['platform', 'cross-platform']).optional();

/** Only credProps is asked for, so only its result may come back. */
const extensionResults = z.strictObject({
  credProps: z.strictObject({ rk: z.boolean().optional() }).optional(),
});

const descriptor = z.object({ type: z.literal('public-key'), id: credentialId, transports });

/** ADR 0010: a passkey counts as MFA only with user verification. */
const userVerification = z.literal('required');

const hints = z
  .array(z.enum(['security-key', 'client-device', 'hybrid']))
  .max(3)
  .optional();

/** PublicKeyCredentialCreationOptionsJSON, to register a passkey. */
export const creationOptionsSchema = z.object({
  rp: z.object({ id: z.string().max(253), name: z.string().max(100) }),
  user: z.object({ id: b64url(86), name: z.string().max(254), displayName: z.string().max(254) }),
  challenge: b64url(128),
  pubKeyCredParams: z
    .array(z.object({ type: z.literal('public-key'), alg: z.int() }))
    .min(1)
    .max(8),
  timeout: z.int().positive().max(600_000).optional(),
  excludeCredentials: z.array(descriptor).max(64).optional(),
  authenticatorSelection: z.object({
    authenticatorAttachment: attachment,
    residentKey: z.enum(['required', 'preferred', 'discouraged']),
    userVerification,
  }),
  hints,
  attestation: z.literal('none'),
  extensions: z.object({ credProps: z.literal(true) }).optional(),
});

/** PublicKeyCredentialRequestOptionsJSON, to sign in or confirm it is you with a passkey. */
export const requestOptionsSchema = z.object({
  challenge: b64url(128),
  timeout: z.int().positive().max(600_000).optional(),
  rpId: z.string().max(253),
  allowCredentials: z.array(descriptor).max(64).optional(),
  userVerification,
  hints,
});

/** RegistrationResponseJSON, from navigator.credentials.create(). */
export const registrationSchema = z.strictObject({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.strictObject({
    clientDataJSON: b64url(8192),
    attestationObject: b64url(16_384),
    authenticatorData: b64url(16_384).optional(),
    transports,
    publicKeyAlgorithm: z.int().optional(),
    publicKey: b64url(2048).optional(),
  }),
  authenticatorAttachment: attachment,
  clientExtensionResults: extensionResults,
});

/** AuthenticationResponseJSON, from navigator.credentials.get(). */
export const authenticationSchema = z.strictObject({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.strictObject({
    clientDataJSON: b64url(8192),
    authenticatorData: b64url(4096),
    signature: b64url(1024),
    /** The WebAuthn user handle, which the server checks against the credential's owner. */
    userHandle: b64url(86).optional(),
  }),
  authenticatorAttachment: attachment,
  clientExtensionResults: extensionResults,
});
