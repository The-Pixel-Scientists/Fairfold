// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MFA asserted by a tenant's own OIDC provider (ADR 0010, "SSO"): it counts
// only when the ID token's `amr` holds, or its `acr` is, a value the
// provider's settings list (auth.sso_provider's mfa_amr and mfa_acr). With
// no match, or no claim, a console session waits for local MFA (S02-09), as
// after a password, so a provider that says nothing never completes it.

import type { MfaState } from '../../../context.ts';

export interface MfaMapping {
  readonly amr: readonly string[];
  readonly acr: readonly string[];
}

export function providerAssertedMfa(
  claims: { readonly amr?: readonly string[] | undefined; readonly acr?: string | undefined },
  mapping: MfaMapping,
): boolean {
  const { amr = [], acr } = claims;
  return (
    amr.some((value) => mapping.amr.includes(value)) ||
    (acr !== undefined && mapping.acr.includes(acr))
  );
}

/** A new console session's MFA state: complete if the provider asserted it, else local MFA. */
export const ssoMfaState = (asserted: boolean, hasAuthenticator: boolean): MfaState =>
  asserted ? 'complete' : hasAuthenticator ? 'verify' : 'enrol';
