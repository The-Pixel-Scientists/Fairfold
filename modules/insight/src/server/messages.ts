// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Refusals the handlers make that the contracts' catalogue does not hold yet,
// in the words of docs/CONTENT-STYLE.md. None repeats a submitted value.

export const serverRefusals = {
  nameTaken: 'Another report has this name. Choose a different name.',
  changedElsewhere: 'Someone else changed this just now. Reload it and try again.',
  needsGrants: 'Equality monitoring reports need Grants. Ask a tenant admin to switch Grants on.',
  sourceOff: 'This report reads a tool that is switched off. Ask a tenant admin to switch it on.',
  sourceUnavailable: 'This table has no figures to report on yet. Choose another table.',
  columnUnavailable: 'This report uses a column that reports cannot read. Choose another column.',
  oneRound: 'Choose one round for this report. Other filters and breakdowns are not available yet.',
} as const;
