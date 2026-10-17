// SPDX-License-Identifier: AGPL-3.0-or-later

import { countCharacters, countWords, tableTotals } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import type { FormHelpers } from '@pixel-scientists/ui';

/** The engine's own counts and money format, so what the applicant sees is what the server checks. */
export const helpers: FormHelpers = { countWords, countCharacters, formatMoney, tableTotals };
