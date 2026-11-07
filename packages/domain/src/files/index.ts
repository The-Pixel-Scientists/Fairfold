// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Platform file contracts (ADR 0047): the `/files` subpath of the domain package.

import '../jitless/index.ts';

export {
  MAX_UPLOAD_BODIES_AT_ONCE,
  uploadBuckets,
  uploadCharge,
  uploadLimitMessage,
  uploadLimits,
  type UploadBucket,
  type UploadLimit,
} from './limits.ts';
export {
  fileNameMessages,
  fileRefusalMessages,
  fileRefusals,
  fileWithheldMessages,
  type FileRefusal,
} from './messages.ts';
export {
  decodeFileNameHeader,
  encodeFileNameHeader,
  fileNameHeader,
  fileNameMatchesType,
  fileNameSchema,
  MAX_FILE_NAME_LENGTH,
} from './name.ts';
export {
  canChangeScanState,
  needsRescan,
  scanStateChanges,
  SIGNATURE_VERSION_TTL_SECONDS,
  signatureVersionSchema,
} from './scan.ts';
export { sniffFileType } from './sniff.ts';
export {
  fileTypeExtensions,
  fileTypeLabels,
  fileTypes,
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
  type FileType,
} from './types.ts';
export {
  fileViewSchema,
  isDownloadable,
  scanStates,
  type FileView,
  type ScanState,
} from './view.ts';
