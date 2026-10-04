// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One ESLint configuration for the workspace (ADR 0001): typed rules from
// typescript-eslint everywhere, React hooks and accessibility rules for the
// console, portal, component library and module screens, and the module
// boundaries (ADR 0016). Formatting is Prettier's job.

import { posix, relative, sep } from 'node:path';

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const reactFiles = [
  'apps/console/src/**/*.{ts,tsx}',
  'apps/portal/src/**/*.{ts,tsx}',
  'packages/ui/src/**/*.{ts,tsx}',
  'modules/*/src/console/**/*.{ts,tsx}',
  'modules/*/src/portal/**/*.{ts,tsx}',
];

const MODULES = ['party', 'grants'];
const ENTRY_POINTS = ['contracts', 'server', 'console', 'portal'];

const moduleContracts = MODULES.map((module) => `@pixel-scientists/${module}/contracts`);
const moduleServers = MODULES.map((module) => `@pixel-scientists/${module}/server`);

/** Every entry point may import @pixel-scientists/domain and its subpaths. */
const DOMAIN = /^@pixel-scientists\/domain(?:\/[a-z0-9-]+)?$/;

/**
 * What each entry point may import (ADR 0016) besides @pixel-scientists/domain:
 * the `allowed` specifiers, and relative paths that resolve inside the
 * `reachable` entry points of the same module.
 *
 * @param {string} module
 * @returns {Record<string, { reachable: string[], allowed: string[], message: string }>}
 */
function entryPoints(module) {
  const screens = {
    allowed: ['react', '@pixel-scientists/ui', ...moduleContracts],
    message:
      "Module screens may import only their own contracts, modules' contracts, @pixel-scientists/ui, @pixel-scientists/domain and React",
  };
  return {
    contracts: {
      reachable: ['contracts'],
      allowed: ['zod', ...moduleContracts],
      message:
        "Module contracts may import only zod, @pixel-scientists/domain and modules' contracts",
    },
    server: {
      reachable: ['server', 'contracts'],
      allowed: [
        '@pixel-scientists/db',
        `@pixel-scientists/db/generated/${module}`,
        ...moduleContracts,
        ...moduleServers,
      ],
      message: `Module server code may import only its own contracts, @pixel-scientists/domain, @pixel-scientists/db with the ${module} schema's generated types, and modules' contracts and server`,
    },
    console: { reachable: ['console', 'contracts'], ...screens },
    portal: { reachable: ['portal', 'contracts'], ...screens },
  };
}

/** @typedef {Parameters<NonNullable<import('eslint').Rule.NodeListener['CallExpression']>>[0]} CallExpression */
/** @typedef {CallExpression['arguments'][number]} Expression */

const MODULE_FILE = /^modules\/([^/]+)\/src\/([^/]+)\//;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * The string a module is loaded by, if it is written as a literal.
 *
 * @param {Expression | undefined} source
 * @returns {string | undefined}
 */
function literalSpecifier(source) {
  if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/**
 * Whether a call loads a module: require(), require.resolve(),
 * import.meta.resolve() or process.getBuiltinModule().
 *
 * @param {CallExpression['callee']} callee
 */
function isLoader(callee) {
  if (callee.type === 'Identifier') return callee.name === 'require';
  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return false;
  const { object, property } = callee;
  return (
    (object.type === 'Identifier' &&
      ((object.name === 'require' && property.name === 'resolve') ||
        (object.name === 'process' && property.name === 'getBuiltinModule'))) ||
    (object.type === 'MetaProperty' && object.meta.name === 'import' && property.name === 'resolve')
  );
}

/**
 * Every file under modules/ sits in one entry point of a module listed in
 * MODULES, and loads only what that entry point may import, by any means:
 * static and dynamic imports, re-exports, import types, require() and the
 * other loader calls. A relative path must resolve inside a reachable entry
 * point, and not into node_modules or to a test file. Tests themselves are
 * exempt.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const moduleImports = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = relative(import.meta.dirname, context.filename)
      .split(sep)
      .join('/');
    const [, module = '', entry = ''] = MODULE_FILE.exec(file) ?? [];
    const boundary =
      MODULES.includes(module) && ENTRY_POINTS.includes(entry)
        ? entryPoints(module)[entry]
        : undefined;
    if (boundary === undefined) {
      return {
        Program(node) {
          context.report({
            node,
            message:
              'Module code lives in modules/<module>/src/contracts, server, console or portal, for a module listed in eslint.config.js (ADR 0016).',
          });
        },
      };
    }
    if (TEST_FILE.test(file)) return {};

    const reachable = boundary.reachable.map((name) => `modules/${module}/src/${name}/`);
    const folder = posix.dirname(file);
    const { allowed } = boundary;
    const message = `${boundary.message} (ADR 0016).`;

    /**
     * @param {import('eslint').Rule.Node} node
     * @param {Expression | undefined} source
     */
    function check(node, source) {
      const specifier = literalSpecifier(source);
      if (specifier === undefined) {
        context.report({
          node,
          message:
            'Name the module to load as a string literal, so its boundary can be checked (ADR 0016).',
        });
        return;
      }
      const target = /^\.{1,2}(?:\/|$)/.test(specifier)
        ? posix.normalize(posix.join(folder, specifier))
        : undefined;
      const permitted =
        target === undefined
          ? DOMAIN.test(specifier) || allowed.includes(specifier)
          : reachable.some((prefix) => target.startsWith(prefix)) &&
            !target.split('/').includes('node_modules') &&
            !TEST_FILE.test(target.replace(/\?.*$/, ''));
      if (!permitted) context.report({ node, message });
    }

    /** @param {import('eslint').Rule.Node & { source?: Expression | null }} node */
    const checkSource = (node) => {
      if (node.source) check(node, node.source);
    };
    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
      TSImportType: checkSource,
      /** @param {import('eslint').Rule.Node & { expression: Expression }} node */
      TSExternalModuleReference(node) {
        check(node, node.expression);
      },
      CallExpression(node) {
        if (isLoader(node.callee)) check(node, node.arguments[0]);
      },
    };
  },
};

/**
 * The module boundaries (ADR 0016). The apps may import any module entry point.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const moduleBoundaries = [
  {
    files: ['modules/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { modules: { rules: { imports: moduleImports } } },
    rules: { 'modules/imports': 'error' },
  },
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
  {
    files: reactFiles,
    rules: {
      // Preflight's list-style: none makes Safari with VoiceOver drop the list
      // role, so lists put it back with role="list".
      'jsx-a11y-x/no-redundant-roles': [
        'error',
        { nav: ['navigation'], ol: ['list'], ul: ['list'] },
      ],
    },
  },
  moduleBoundaries,
  {
    files: ['apps/*/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Import test and expect from scripts/e2e/fixtures.ts, which fails a test that breaks the Content Security Policy.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
