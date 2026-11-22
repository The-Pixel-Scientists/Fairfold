// SPDX-License-Identifier: AGPL-3.0-or-later

/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  // Helm templates are Go templates that only render to YAML, so Prettier
  // cannot parse them; it leaves alone any file without a @format pragma.
  overrides: [{ files: 'infra/helm/templates/**', options: { requirePragma: true } }],
};
