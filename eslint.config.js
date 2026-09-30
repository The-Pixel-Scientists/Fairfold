// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One ESLint configuration for the workspace (ADR 0001): typed rules from
// typescript-eslint everywhere, plus React hooks and accessibility rules for
// the console, portal and component library. Formatting is Prettier's job.

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const reactFiles = [
  'apps/console/src/**/*.{ts,tsx}',
  'apps/portal/src/**/*.{ts,tsx}',
  'packages/ui/src/**/*.{ts,tsx}',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      'playwright-report/',
      'test-results/',
      // Semgrep's rule tests hold deliberately bad code.
      'infra/semgrep/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: reactFiles,
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: reactFiles,
    ...jsxA11y.configs.strict,
  },
);
