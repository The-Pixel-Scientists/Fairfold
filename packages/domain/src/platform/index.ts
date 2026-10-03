// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Platform contracts: the `/platform` subpath of the domain package.

export {
  appSchema,
  apps,
  permissionSchema,
  permissions,
  scopeRules,
  type App,
  type Permission,
  type ScopeRule,
} from './access.ts';
export {
  auditActionPattern,
  auditEntityType,
  defineAuditActions,
  isAuditAction,
  platformAuditActions,
  type AuditAction,
  type PlatformAuditAction,
} from './audit.ts';
export {
  checkLogo,
  LOGO_MAX_BYTES,
  LOGO_MAX_HEIGHT,
  LOGO_MAX_WIDTH,
  type LogoCheck,
} from './logo.ts';
export {
  catalogueParams,
  fieldForIssue,
  messageForIssue,
  messages,
  type FieldProblem,
  type IssueLike,
} from './messages.ts';
export {
  moduleIds,
  moduleSchema,
  modules,
  switchableModuleIds,
  type ModuleId,
  type SwitchableModuleId,
} from './modules.ts';
export { currencies, formatMoney, moneySchema, type Currency, type Money } from './money.ts';
export { permissionsFor, roleSchema, roles, type Role } from './roles.ts';
export { reservedSlugs, slugPattern, slugSchema } from './tenant.ts';
export {
  brandColourSchema,
  checkTheme,
  contrastRatio,
  defaultTheme,
  deriveShades,
  logoTypes,
  MIN_CONTRAST,
  presetLabels,
  presets,
  themeSchema,
  type LogoType,
  type Preset,
  type Theme,
  type ThemeCheck,
  type ThemeShades,
} from './theme.ts';
