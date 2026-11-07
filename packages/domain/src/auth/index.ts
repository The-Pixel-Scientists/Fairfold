// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auth contracts: the `/auth` subpath of the domain package.

import '../jitless/index.ts';

export {
  changePassword,
  completeEmailChange,
  confirmTotpChange,
  emailChangeLinkPath,
  removeTotp,
  requestEmailChange,
  startTotpChange,
} from './account-routes.ts';
export { countBackupCodes, generateBackupCodes, verifyBackupCode } from './backup-code-routes.ts';
export { authEventCodes, type AuthEventCode } from './events.ts';
export { acceptInvitation } from './invitation-routes.ts';
export { confirmTotp, enrolTotp, stepUp, stepUpWithPassword, verifyTotp } from './mfa-routes.ts';
export {
  addPasskey,
  completeSignUpWithPasskey,
  listPasskeys,
  passkeyMfaOptions,
  passkeyRegistrationOptions,
  passkeySignInOptions,
  passkeyStepUpOptions,
  removePasskey,
  signInWithPasskey,
  signUpPasskeyOptions,
  stepUpWithPasskey,
  verifyPasskeyMfa,
} from './passkey-routes.ts';
export {
  authRoutes,
  completePasswordReset,
  completeSignUp,
  getSession,
  requestPasswordReset,
  signIn,
  signOut,
  startSignUp,
  switchTenant,
} from './routes.ts';
export {
  backupCodeSchema,
  currentPasswordSchema,
  emailSchema,
  mfaStates,
  passkeyNameSchema,
  passwordSchema,
  sessionSchema,
  tokenSchema,
  totpCodeSchema,
  type Session,
} from './schemas.ts';
export {
  addSsoDomain,
  addSsoProvider,
  changeSsoProvider,
  getSsoProvider,
  listSsoProviders,
  removeSsoDomain,
  removeSsoProvider,
  ssoAdminRoutes,
  verifySsoDomain,
} from './sso-admin-routes.ts';
export { completeOidc, completeSaml, samlAcs, startSso, startSsoStepUp } from './sso-routes.ts';
export { domainNameSchema } from './sso-schemas.ts';
