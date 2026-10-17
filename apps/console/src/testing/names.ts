// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Matchers for the accessible names tests look up by role. They take plain
// text, so a name never has to be built into a regular expression. Not part of
// the app.

/** A name that holds `text` somewhere in it. */
export const containing = (text: string) => (name: string) => name.includes(text);

/** A name that is `first` and then `second`, with any spacing between: "Move down Costs". */
export const joined = (first: string, second: string) => (name: string) =>
  name.startsWith(first) && name.slice(first.length).trimStart() === second;
