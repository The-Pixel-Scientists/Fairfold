// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auth contracts: the `/auth` subpath of the domain package.

import '../jitless/index.ts';

export { authEventCodes, type AuthEventCode } from './events.ts';
export { confirmTotp, enrolTotp, stepUp, verifyTotp } from './mfa-routes.ts';
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
  currentPasswordSchema,
  emailSchema,
  mfaStates,
  passwordSchema,
  sessionSchema,
  tokenSchema,
  totpCodeSchema,
  type Session,
} from './schemas.ts';
