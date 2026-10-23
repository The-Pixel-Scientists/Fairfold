// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's brand colour, preset, logo and own design tokens (ADR 0019, ADR
// 0046). The contract's schema has already refused a colour that fails
// contrast. Each change writes a configuration version and
// `platform.theme.changed`. The version and the audit event name a logo by its
// type and SHA-256 digest, never its bytes, and tokens by name and value. Tokens
// replace the preset, so saving a preset or brand colour clears them.

import {
  checkTokens,
  defaultTheme,
  tokenPaths,
  tokenSetSchema,
  tokenValue,
  type LogoType,
  type Preset,
  type TokenSet,
} from '@pixel-scientists/domain/platform';
import type {
  ConfigDiff,
  getTheme,
  ThemeSettings,
  updateTheme,
} from '@pixel-scientists/domain/platform/settings';

import type { MemberContext } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';
import type { Handler } from '../../routes/register.ts';
import { settingsTables } from './tables.ts';

export interface LogoRef {
  readonly type: LogoType;
  readonly sha256: string;
}

interface Theme {
  readonly brandColour: string;
  readonly preset: Preset;
  readonly logo: LogoRef | null;
  /** The tokens in use: stored and still passing every check, as theme.css would serve them. */
  readonly tokens: TokenSet | null;
  /** Whether anything is stored in the tokens column, usable or not. */
  readonly tokensStored: boolean;
}

function usableTokens(stored: unknown): TokenSet | null {
  const parsed = tokenSetSchema.safeParse(stored);
  return parsed.success && checkTokens(parsed.data).length === 0 ? parsed.data : null;
}

/** The stored theme, or the default look until the tenant first saves one. Never the logo's bytes. */
async function readTheme(tx: TenantTransaction): Promise<Theme> {
  const row = await settingsTables(tx)
    .selectFrom('app.tenant_theme')
    .select((eb) => [
      'brand_colour',
      'preset',
      'logo_type',
      'tokens',
      eb.fn<string | null>('encode', [eb.fn('sha256', ['logo']), eb.val('hex')]).as('logo_sha256'),
    ])
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) {
    return {
      brandColour: defaultTheme.brandColour,
      preset: defaultTheme.preset,
      logo: null,
      tokens: null,
      tokensStored: false,
    };
  }
  return {
    brandColour: row.brand_colour,
    preset: row.preset,
    tokens: usableTokens(row.tokens),
    tokensStored: row.tokens !== null,
    logo:
      row.logo_type === null || row.logo_sha256 === null
        ? null
        : { type: row.logo_type, sha256: row.logo_sha256 },
  };
}

const settings = (theme: Theme): ThemeSettings => ({
  brandColour: theme.brandColour,
  preset: theme.preset,
  hasLogo: theme.logo !== null,
  tokens: theme.tokens,
});

/** A logo to store: its bytes, with the type checkLogo() read from them and their digest. */
export interface NewLogo extends LogoRef {
  readonly bytes: Buffer;
}

export interface ThemeChange {
  readonly brandColour?: string;
  readonly preset?: Preset;
  /** A new logo, or null to remove it. Left out to keep it. */
  readonly logo?: NewLogo | null;
  /** The funder's own tokens, already checked, or null to clear them. Left out to keep them. */
  readonly tokens?: TokenSet | null;
}

/** The tokens whose values differ, by name. A side with no tokens set reads as null. */
function tokenChanges(before: TokenSet | null, after: TokenSet | null) {
  return tokenPaths.flatMap((token) => {
    const from = before && tokenValue(before, token);
    const to = after && tokenValue(after, token);
    return from === to ? [] : [{ field: 'token' as const, token, from, to }];
  });
}

const ref = (logo: LogoRef | null): LogoRef | null =>
  logo && { type: logo.type, sha256: logo.sha256 };

/** Saves the change, and records its version and audit event. A change that alters nothing writes nothing. */
export async function saveTheme(
  tx: TenantTransaction,
  context: MemberContext,
  change: ThemeChange,
): Promise<ThemeSettings> {
  const before = await readTheme(tx);
  const brandColour = change.brandColour ?? before.brandColour;
  const preset = change.preset ?? before.preset;
  const logo = change.logo === undefined ? before.logo : change.logo;
  const tokens = change.tokens === undefined ? before.tokens : change.tokens;

  const diff: ConfigDiff<'platform.theme'> = [];
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (brandColour !== before.brandColour) {
    diff.push({ field: 'brandColour', from: before.brandColour, to: brandColour });
    changes['app.tenant_theme.brand_colour'] = { before: before.brandColour, after: brandColour };
  }
  if (preset !== before.preset) {
    diff.push({ field: 'preset', from: before.preset, to: preset });
    changes['app.tenant_theme.preset'] = { before: before.preset, after: preset };
  }
  if (logo?.sha256 !== before.logo?.sha256 || logo?.type !== before.logo?.type) {
    diff.push({ field: 'logo', from: ref(before.logo), to: ref(logo) });
    changes['app.tenant_theme.logo_type'] = { before: before.logo?.type, after: logo?.type };
    changes['app.tenant_theme.logo'] = { before: before.logo?.sha256, after: logo?.sha256 };
  }
  const tokenDiff = tokenChanges(before.tokens, tokens);
  if (tokenDiff.length > 0) {
    diff.push(...tokenDiff);
    changes['app.tenant_theme.tokens'] = {
      before: Object.fromEntries(tokenDiff.map(({ token, from }) => [token, from])),
      after: Object.fromEntries(tokenDiff.map(({ token, to }) => [token, to])),
    };
  }
  // Tokens that no longer pass are not in use, so clearing them changes no look and no version
  // diff, but it still changes stored data when the column is set to NULL: the audit event
  // records that with a marker, never the failing values.
  const clearsStale = change.tokens === null && before.tokensStored && before.tokens === null;
  if (clearsStale) changes['app.tenant_theme.tokens'] = { before: 'unusable', after: null };
  if (diff.length === 0 && !clearsStale) return settings(before);

  const set = {
    brand_colour: brandColour,
    preset,
    updated_by: context.membership.id,
    ...(change.tokens === undefined ? {} : { tokens: tokens && JSON.stringify(tokens) }),
    ...(change.logo === undefined
      ? {}
      : { logo: change.logo?.bytes ?? null, logo_type: change.logo?.type ?? null }),
  };
  const saved = await settingsTables(tx)
    .insertInto('app.tenant_theme')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      logo: null,
      logo_type: null,
      tokens: null,
      ...set,
    }))
    .onConflict((conflict) => conflict.column('tenant_id').doUpdateSet(set))
    .returning('id')
    .executeTakeFirstOrThrow();

  if (diff.length > 0) await context.config.record('platform.theme', saved.id, diff);
  await context.audit.record({ action: 'platform.theme.changed', entityId: saved.id, changes });
  return { brandColour, preset, hasLogo: logo !== null, tokens };
}

export const getThemeHandler: Handler<typeof getTheme> = async ({ tx }) =>
  settings(await readTheme(tx));

export const updateThemeHandler: Handler<typeof updateTheme> = ({ tx, context, input }) =>
  saveTheme(tx, context, { ...input.body, tokens: null });
