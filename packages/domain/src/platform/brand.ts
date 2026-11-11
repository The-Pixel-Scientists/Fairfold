// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The names people see. Code identifiers never carry a brand (ADR 0021), so
// renaming the product changes this file and the docs.

/** The suite every module belongs to, as in "Fairfold API". */
export const suiteName = 'Fairfold';

/** This product, shown in app headers and page titles. */
export const productName = `${suiteName} Grants`;

/**
 * Each tool's plain descriptor, by module id, shown after the suite name, as
 * in "Fairfold CRM".
 */
export const toolNames = {
  grants: 'Grants',
  crm: 'CRM',
  assure: 'Due Diligence',
  forms: 'Forms',
  privacy: 'Data Protection',
  insight: 'Reporting',
  impact: 'Impact',
} as const;
