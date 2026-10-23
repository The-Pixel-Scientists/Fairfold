// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tables the settings routes query (migration 0002), as the API's role
// may reach them. Inserts take `tenant_id` from `app.current_tenant_id()`, the
// transaction's own tenant, never from a value.

import type { LogoType, Preset } from '@pixel-scientists/domain/platform';

import type { TenantTransaction } from '../../database.ts';

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type SettingsTables = {
  'app.tenant': { id: string; name: string; timezone: string; fiscal_year_start_month: number };
  'app.tenant_theme': {
    tenant_id: string;
    id: Generated<string>;
    brand_colour: string;
    preset: Preset;
    logo: Buffer | null;
    logo_type: LogoType | null;
    /** Unchecked jsonb: parse it with tokenSetSchema before use. Written as JSON text. */
    tokens: { __select__: unknown; __insert__: string | null; __update__: string | null };
    updated_by: string;
  };
  'app.tenant_module': {
    tenant_id: string;
    id: Generated<string>;
    module: string;
    enabled: boolean;
    updated_by: string;
  };
};

export const settingsTables = (tx: TenantTransaction) => tx.$extendTables<SettingsTables>();
