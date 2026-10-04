// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0002's checks copy lists and limits from the platform contracts
// in packages/domain (S02-01). This reads each check back from the database
// and compares it with the list it copies, so neither can change alone.

import {
  LOGO_MAX_BYTES,
  logoTypes,
  presets,
  reservedSlugs,
  roles,
  slugPattern,
  switchableModuleIds,
} from '@pixel-scientists/domain/platform';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

/** Each check in the app schema, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
beforeAll(async () => {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ name: string; definition: string }>(
      `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
         FROM pg_catalog.pg_constraint o
        WHERE o.connamespace = 'app'::regnamespace AND o.contype = 'c'`,
    ),
  );
  checks = new Map(rows.map((row) => [row.name, row.definition]));
});

/** The text literals in a check, in order. */
function literals(check: string): string[] {
  const definition = checks.get(check);
  if (definition === undefined) throw new Error(`There is no check named ${check}.`);
  return [...definition.matchAll(/'((?:[^']|'')*)'::text/g)].map((match) =>
    (match[1] ?? '').replaceAll("''", "'"),
  );
}

describe('the checks in migration 0002', () => {
  it.each([
    ['membership roles', 'membership_roles_check', Object.keys(roles)],
    ['switchable modules', 'tenant_module_module_check', switchableModuleIds],
    ['theme presets', 'tenant_theme_preset_check', presets],
    ['logo types', 'tenant_theme_logo_type_check', logoTypes],
    ['reserved slugs', 'tenant_slug_not_reserved', reservedSlugs],
    ['slug pattern', 'tenant_slug_format', [slugPattern.source]],
  ])('allow exactly the %s in the domain package', (_, check, expected) => {
    expect(literals(check).sort()).toEqual([...expected].sort());
  });

  it('allow a logo of at most LOGO_MAX_BYTES', () => {
    expect(checks.get('tenant_theme_logo_check')).toBe(
      `CHECK (((octet_length(logo) >= 1) AND (octet_length(logo) <= ${String(LOGO_MAX_BYTES)})))`,
    );
  });
});
