// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The insight module's staff screens (ADR 0016): one page at `/insight` that
// the console's shell loads when the tool is first opened. Its screens are
// chosen by the address's search string (`?view=publication`), because the
// shell registers one path for the tool.

export { default } from './InsightPage.tsx';
