// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Evaluates a package's declared licence against licence-policy.json
// (ADR 0002):
//   - the expression must parse as SPDX; nothing else passes, not even with
//     an exception;
//   - deprecated SPDX ids are read as their current ones, so "GPL-2.0" is
//     "GPL-2.0-only";
//   - `OR` passes if any branch passes; `AND` needs every part;
//   - a licence WITH an exception passes only if that exact combination is
//     listed, and is denied if either half is denied;
//   - an expression with no branch free of denied licences fails outright;
//   - otherwise a per-package exception for that exact version may pass it,
//     but only if a branch uses nothing outside `allowed` and
//     `allowedPerPackage`.

import parseSpdx from 'spdx-expression-parse';

export interface LicenceException {
  package: string;
  version: string;
  licence: string;
  scope: 'development' | 'all';
  reason: string;
  approver: string;
  date: string;
}

export interface LicencePolicy {
  allowed: string[];
  allowedPerPackage: string[];
  denied: string[];
  exceptions: LicenceException[];
}

export interface InstalledPackage {
  name: string;
  version: string;
  licence: string;
  /** Whether the package is in the production dependency tree. */
  production: boolean;
}

export type Verdict = { ok: true; exception?: LicenceException } | { ok: false; reason: string };

type ParsedNode =
  | { license: string; plus?: boolean; exception?: string }
  | { left: ParsedNode; conjunction: 'and' | 'or'; right: ParsedNode };

/** One licence, with its WITH exception if it has one, in current SPDX ids. */
interface Term {
  licence: string;
  exception?: string;
}

type Tree = Term | { left: Tree; conjunction: 'and' | 'or'; right: Tree };

/** Deprecated SPDX licence ids and what they mean in current ids. */
const DEPRECATED: Readonly<Record<string, Term>> = {
  'AGPL-1.0': { licence: 'AGPL-1.0-only' },
  'AGPL-3.0': { licence: 'AGPL-3.0-only' },
  'BSD-2-Clause-FreeBSD': { licence: 'BSD-2-Clause-Views' },
  'BSD-2-Clause-NetBSD': { licence: 'BSD-2-Clause' },
  'GFDL-1.1': { licence: 'GFDL-1.1-only' },
  'GFDL-1.2': { licence: 'GFDL-1.2-only' },
  'GFDL-1.3': { licence: 'GFDL-1.3-only' },
  'GPL-1.0': { licence: 'GPL-1.0-only' },
  'GPL-2.0': { licence: 'GPL-2.0-only' },
  'GPL-2.0-with-GCC-exception': { licence: 'GPL-2.0-only', exception: 'GCC-exception-2.0' },
  'GPL-2.0-with-autoconf-exception': {
    licence: 'GPL-2.0-only',
    exception: 'Autoconf-exception-2.0',
  },
  'GPL-2.0-with-bison-exception': { licence: 'GPL-2.0-only', exception: 'Bison-exception-2.2' },
  'GPL-2.0-with-classpath-exception': {
    licence: 'GPL-2.0-only',
    exception: 'Classpath-exception-2.0',
  },
  'GPL-2.0-with-font-exception': { licence: 'GPL-2.0-only', exception: 'Font-exception-2.0' },
  'GPL-3.0': { licence: 'GPL-3.0-only' },
  'GPL-3.0-with-GCC-exception': { licence: 'GPL-3.0-only', exception: 'GCC-exception-3.1' },
  'GPL-3.0-with-autoconf-exception': {
    licence: 'GPL-3.0-only',
    exception: 'Autoconf-exception-3.0',
  },
  'LGPL-2.0': { licence: 'LGPL-2.0-only' },
  'LGPL-2.1': { licence: 'LGPL-2.1-only' },
  'LGPL-3.0': { licence: 'LGPL-3.0-only' },
  Nunit: { licence: 'zlib-acknowledgement' },
  'StandardML-NJ': { licence: 'SMLNJ' },
  'bzip2-1.0.5': { licence: 'bzip2-1.0.6' },
  'eCos-2.0': { licence: 'GPL-2.0-or-later', exception: 'eCos-exception-2.0' },
  wxWindows: { licence: 'LGPL-2.0-or-later', exception: 'WxWindows-exception-3.1' },
};

function term(node: { license: string; plus?: boolean; exception?: string }): Term {
  const current = DEPRECATED[node.license] ?? { licence: node.license };
  let licence = current.licence;
  if (node.plus) {
    // "X+" means X or any later version.
    licence = licence.endsWith('-only')
      ? `${licence.slice(0, -'-only'.length)}-or-later`
      : licence.endsWith('-or-later')
        ? licence
        : `${licence}+`;
  }
  const exception = node.exception ?? current.exception;
  return exception ? { licence, exception } : { licence };
}

function normalise(node: ParsedNode): Tree {
  if ('license' in node) return term(node);
  return {
    left: normalise(node.left),
    conjunction: node.conjunction,
    right: normalise(node.right),
  };
}

function parse(expression: string): Tree | undefined {
  try {
    return normalise(parseSpdx(expression.trim()));
  } catch {
    return undefined;
  }
}

function key(item: Term): string {
  return item.exception ? `${item.licence} WITH ${item.exception}` : item.licence;
}

function satisfies(tree: Tree, accept: (item: Term) => boolean): boolean {
  if ('licence' in tree) return accept(tree);
  return tree.conjunction === 'or'
    ? satisfies(tree.left, accept) || satisfies(tree.right, accept)
    : satisfies(tree.left, accept) && satisfies(tree.right, accept);
}

function terms(tree: Tree): Term[] {
  if ('licence' in tree) return [tree];
  return [...terms(tree.left), ...terms(tree.right)];
}

export function evaluate(pkg: InstalledPackage, policy: LicencePolicy): Verdict {
  const id = `${pkg.name}@${pkg.version}`;
  const tree = parse(pkg.licence);
  if (!tree) return { ok: false, reason: `${id} has no valid SPDX licence ("${pkg.licence}")` };

  const inList = (list: readonly string[]) => (item: Term) => list.includes(key(item));
  const isDenied = (item: Term): boolean =>
    policy.denied.includes(key(item)) ||
    policy.denied.includes(item.licence) ||
    (item.exception !== undefined && policy.denied.includes(item.exception));

  if (satisfies(tree, inList(policy.allowed))) return { ok: true };

  if (!satisfies(tree, (item) => !isDenied(item))) {
    const denied = terms(tree).filter(isDenied).map(key);
    return { ok: false, reason: `${id} is under a denied licence (${denied.join(', ')})` };
  }

  const exception = policy.exceptions.find(
    (entry) => entry.package === pkg.name && entry.version === pkg.version,
  );
  if (!exception || exception.licence !== pkg.licence) {
    return {
      ok: false,
      reason: `${id} is under ${pkg.licence}, which needs a recorded exception in licence-policy.json`,
    };
  }
  if (!satisfies(tree, inList([...policy.allowed, ...policy.allowedPerPackage]))) {
    return {
      ok: false,
      reason: `${id} is under ${pkg.licence}, which ADR 0002 does not allow even with an exception`,
    };
  }
  if (!exception.reason.trim() || !exception.approver.trim() || !exception.date.trim()) {
    return { ok: false, reason: `the exception for ${id} needs a reason, an approver and a date` };
  }
  if (exception.scope === 'development' && pkg.production) {
    return {
      ok: false,
      reason: `${id} has a development-only exception but is a production dependency`,
    };
  }
  return { ok: true, exception };
}

/** Problems with the policy file itself, such as a licence in two lists. */
export function policyProblems(policy: LicencePolicy): string[] {
  const problems: string[] = [];
  const lists = {
    allowed: policy.allowed,
    allowedPerPackage: policy.allowedPerPackage,
    denied: policy.denied,
  };
  const seen = new Map<string, string>();
  for (const [name, list] of Object.entries(lists)) {
    for (const licence of list) {
      const other = seen.get(licence);
      if (other) problems.push(`licence-policy.json lists ${licence} in both ${other} and ${name}`);
      seen.set(licence, name);
    }
  }
  return problems;
}

/** Exceptions that match no installed package, so can be removed. */
export function unusedExceptions(
  packages: readonly InstalledPackage[],
  policy: LicencePolicy,
): LicenceException[] {
  return policy.exceptions.filter(
    (entry) => !packages.some((pkg) => pkg.name === entry.package && pkg.version === entry.version),
  );
}
