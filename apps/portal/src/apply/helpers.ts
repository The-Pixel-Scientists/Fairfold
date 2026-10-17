// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileTypeLabels, sniffFileType } from '@pixel-scientists/domain/files';
import {
  checkFile,
  countCharacters,
  countWords,
  tableTotals,
} from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import type { FileHelpers, FormHelpers } from '@pixel-scientists/ui';

/**
 * The engine's own counts, money format and file checks, so what the
 * applicant sees is what the server checks. The browser checks a file only to
 * warn early: the server finds its type again from its bytes.
 */
export const helpers: FormHelpers & FileHelpers = {
  countWords,
  countCharacters,
  formatMoney,
  tableTotals,
  fileTypeLabels,
  sniffFileType,
  checkFile,
};
