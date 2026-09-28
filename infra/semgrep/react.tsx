// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for react.yaml, checked by `semgrep --test infra/semgrep`.

declare const html: string;
declare const createElement: (tag: string, props: object) => unknown;

export function Unsafe() {
  // ruleid: pixelgrant-no-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UnsafeWithChildren() {
  // ruleid: pixelgrant-no-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: html }}></div>;
}

// ruleid: pixelgrant-no-dangerously-set-inner-html
createElement('div', { dangerouslySetInnerHTML: { __html: html } });

export function Safe() {
  // ok: pixelgrant-no-dangerously-set-inner-html
  return <div>{html}</div>;
}
