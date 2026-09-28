// SPDX-License-Identifier: AGPL-3.0-or-later
//
// spdx-expression-parse 5 ships no types. This covers the one function used.

declare module 'spdx-expression-parse' {
  interface LicenseNode {
    license: string;
    plus?: true;
    exception?: string;
  }

  interface ConjunctionNode {
    left: LicenseNode | ConjunctionNode;
    conjunction: 'and' | 'or';
    right: LicenseNode | ConjunctionNode;
  }

  /** Parse an SPDX licence expression. Throws on an invalid expression. */
  export default function parse(source: string): LicenseNode | ConjunctionNode;
}
