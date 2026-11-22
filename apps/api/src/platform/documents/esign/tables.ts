// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the e-signature code touches and no others (ADR 0040, rules 8
// and 9): a request never changes an application, award, decision or
// payment. Each role reads and writes only the columns migrations 0101 to
// 0105 grant it, so the typings here do not widen anything.

import type {
  AppFile,
  AppSignatureConnection,
  AppSignatureRequest,
  AppSignatureRequestFile,
  AppSignatureSigner,
} from '@pixel-scientists/db/generated/app';

export type EsignTables = {
  'app.file': AppFile;
  'app.signature_connection': AppSignatureConnection;
  'app.signature_request': AppSignatureRequest;
  'app.signature_request_file': AppSignatureRequestFile;
  'app.signature_signer': AppSignatureSigner;
};
