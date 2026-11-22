// SPDX-License-Identifier: AGPL-3.0-or-later
//
// E-signature and document generation contracts (ADR 0040): the
// `/documents` subpath of the domain package. The fake provider for tests is
// `/documents/testing`.

import '../jitless/index.ts';

export {
  canMoveTo,
  isExpiryAllowed,
  MAX_EXPIRY_DAYS,
  MAX_SIGNERS,
  signatureFailures,
  signatureRequestSchema,
  signatureStatuses,
  signerStatuses,
  type SignatureFailure,
  type SignatureRequest,
  type SignatureStatus,
  type SignerStatus,
} from './esign.ts';
export { signatureEvents } from './events.ts';
export {
  documentFailureMessages,
  documentsMessages,
  signatureFailureMessages,
  signatureStatusLabels,
  templateFieldMessages,
} from './messages.ts';
export {
  callbackHintSchema,
  envelopeCreatedSchema,
  envelopeFoundSchema,
  envelopeStates,
  envelopeStatusSchema,
  providerEvidenceSchema,
  providerFileSchema,
  providerReferenceSchema,
  sha256Schema,
  type CallbackRequest,
  type EnvelopeInput,
  type EnvelopeState,
  type EnvelopeStatus,
  type ProviderConnection,
  type SignatureProvider,
  type SignerContact,
} from './provider.ts';
export {
  callbackReferenceSchema,
  MAX_CALLBACK_BODY_BYTES,
  signatureCallbackParamsSchema,
  signatureCallbackPath,
} from './routes.ts';
export {
  bodyFields,
  checkTemplateFields,
  documentFailures,
  documentFields,
  documentKinds,
  documentRequestSchema,
  MAX_DOCUMENT_SUBJECTS,
  MAX_MERGE_FIELDS,
  MAX_TEMPLATE_BLOCKS,
  MAX_TEMPLATE_BODY_LENGTH,
  NOT_SHOWN,
  templateBlockSchema,
  templateFieldRefusals,
  templateVersionSchema,
  type DocumentFailure,
  type DocumentFields,
  type DocumentKind,
  type DocumentRequest,
  type TemplateBlock,
  type TemplateFieldProblem,
  type TemplateFieldRefusal,
  type TemplateFields,
  type TemplateVersion,
} from './templates.ts';
