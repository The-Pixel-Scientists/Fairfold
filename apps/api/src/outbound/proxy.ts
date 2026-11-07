// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The proxy check (ADR 0010): a proxy would resolve host names where the
// address policy cannot check them, so the API and the worker refuse to run
// with one configured. The variables are matched in any case, and are found
// even when set to an empty string. A message names the variable, never its
// value.

const PROXY_VARIABLES: ReadonlySet<string> = new Set([
  'http_proxy',
  'https_proxy',
  'node_use_env_proxy',
]);

export function proxyProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.keys(env)
    .filter((name) => PROXY_VARIABLES.has(name.toLowerCase()))
    .map(
      (name) =>
        `${name} is set. The API does not use a proxy, so unset it: ` +
        'a proxy would resolve names where the API cannot check them.',
    );
}
