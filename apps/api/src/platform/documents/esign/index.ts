// SPDX-License-Identifier: AGPL-3.0-or-later
//
// E-signature (ADR 0040): the adapter registry, the send service platform and
// module code call, the worker's send and refresh jobs, and the callback
// handler. Only this folder knows a provider.

import type { JobHandler } from '@pixel-scientists/db/jobs';

import { refreshHandler, type RefreshJobDependencies } from './refresh-job.ts';
import { sendHandler, type SendJobDependencies } from './send-job.ts';

export {
  createCallbackHandler,
  referenceHash,
  callbackSecret,
  resolveCallback,
} from './callback.ts';
export type { CallbackDependencies, CallbackOutcome } from './callback.ts';
export { createProviders, type ProviderKey, type SignatureProviders } from './registry.ts';
export { createSigning, type SigningRequester } from './send.ts';
export { loadEsignSettings, type EsignSettings } from './settings.ts';
export type { ResultFiles, StoreResults } from './refresh-job.ts';
export type { SealedConnection } from './connection.ts';

/** What the worker needs to run both signature jobs. */
export type EsignJobDependencies = SendJobDependencies & RefreshJobDependencies;

export const esignHandlers = (deps: EsignJobDependencies): readonly JobHandler<unknown>[] => [
  sendHandler(deps),
  refreshHandler(deps),
];
