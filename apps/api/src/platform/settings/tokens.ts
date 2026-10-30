// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A funder's own design tokens (ADR 0046): saved, or removed to go back to the
// preset. The body is parsed again with the schema and every contrast pair is
// checked, so a refusal names every problem by token path, in the catalogue's
// words. Nothing is saved until all of it passes.

import {
  checkTokens,
  fieldForIssue,
  messageForIssue,
  messages,
  tokenSetSchema,
} from '@pixel-scientists/domain/platform';
import type {
  removeThemeTokens,
  updateThemeTokens,
} from '@pixel-scientists/domain/platform/settings';

import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import { saveTheme } from './theme.ts';

export const updateThemeTokensHandler: Handler<typeof updateThemeTokens> = ({
  tx,
  context,
  input,
}) => {
  const parsed = tokenSetSchema.safeParse(input.body.tokens);
  const problems = parsed.success
    ? checkTokens(parsed.data).map(({ field, message }) => ({
        field: `body.tokens.${field}`,
        message,
      }))
    : parsed.error.issues.map((issue) => ({
        field: fieldForIssue('body.tokens', issue),
        message: messageForIssue(issue),
      }));
  if (!parsed.success || problems.length > 0) {
    throw new ApiError(400, messages.fixFields, { errors: problems, reason: 'tokens_refused' });
  }
  return saveTheme(tx, context, { tokens: parsed.data });
};

export const removeThemeTokensHandler: Handler<typeof removeThemeTokens> = ({ tx, context }) =>
  saveTheme(tx, context, { tokens: null });
