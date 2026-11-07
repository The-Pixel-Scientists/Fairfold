// SPDX-License-Identifier: AGPL-3.0-or-later

export { AuthenticatorKey } from './AuthenticatorKey.tsx';
export type { AuthenticatorKeyProps } from './AuthenticatorKey.tsx';
export { BackupCodeList } from './BackupCodeList.tsx';
export type { BackupCodeListProps } from './BackupCodeList.tsx';
export { PasskeyList } from './PasskeyList.tsx';
export type { PasskeyItem, PasskeyListProps } from './PasskeyList.tsx';
export {
  createPasskey,
  fromBase64url,
  getPasskeyAssertion,
  passkeysSupported,
  toBase64url,
} from './webauthn.ts';
export type {
  AuthenticationJSON,
  CreationOptionsJSON,
  PasskeyResult,
  RegistrationJSON,
  RequestOptionsJSON,
} from './webauthn.ts';
export { asProblem, formText } from './problems.ts';
export type { FieldProblemLike, ProblemLike } from './problems.ts';
export { StepUpDialog } from './StepUpDialog.tsx';
export type { StepUpCredentials, StepUpDialogProps } from './StepUpDialog.tsx';
export { useSubmit } from './useSubmit.ts';
export type { UseSubmit } from './useSubmit.ts';
