// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's logo (ADR 0019). It arrives as base64 in JSON, and is checked
// here on its decoded bytes: PNG or WebP, still, within the size limits, with
// its type read from the bytes and never from the request.

import { createHash } from 'node:crypto';

import { checkLogo, LOGO_MAX_BYTES, messages } from '@pixel-scientists/domain/platform';
import type { removeLogo, uploadLogo } from '@pixel-scientists/domain/platform/settings';

import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import { saveTheme } from './theme.ts';

/** A base64 logo of the largest size, and a little for the JSON around it. */
export const LOGO_BODY_LIMIT_BYTES = 4 * Math.ceil(LOGO_MAX_BYTES / 3) + 1024;

export const uploadLogoHandler: Handler<typeof uploadLogo> = ({ tx, context, input }) => {
  const bytes = Buffer.from(input.body.data, 'base64');
  const checked = checkLogo(bytes);
  if (!checked.ok) {
    throw new ApiError(400, messages.fixFields, {
      errors: [{ field: 'body.data', message: checked.message }],
      reason: 'logo_refused',
    });
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return saveTheme(tx, context, { logo: { type: checked.type, sha256, bytes } });
};

export const removeLogoHandler: Handler<typeof removeLogo> = ({ tx, context }) =>
  saveTheme(tx, context, { logo: null });
