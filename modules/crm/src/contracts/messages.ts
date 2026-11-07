// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's validation messages, in the words of
// docs/CONTENT-STYLE.md: what is wrong and how to fix it. Each is attached
// with says(), which marks it as written from a catalogue, so
// messageForIssue() shows it on both sides. None repeats a value.

import { catalogueParams } from '@pixel-scientists/domain/platform';
import type { MergeConflict } from '@pixel-scientists/party/contracts';

export const crmMessages = {
  hiddenCharacters: 'Remove line breaks and hidden characters.',
  hiddenCharactersText: 'Remove hidden characters.',
  listedOnce: 'List each item once.',
  partyKind: 'Choose organisations or people.',
  partyStatus: 'Choose a status: active, archived, merged or erased.',
  verification: 'Choose verified, claimed or no identifier.',
  interactionKind: 'Choose the kind of interaction: note, call, meeting or email.',
  interactionSummary: 'Enter a short summary of the interaction.',
  duplicateSignal: 'Choose a reason the records may be duplicates from the list.',
  dismissReason: 'Choose why these two records are not duplicates.',
  samePartyTwice: 'Choose two different records.',
  previewToken: 'Preview the merge again, then confirm it.',
  listName: 'Enter a name for the list.',
  segmentName: 'Enter a name for the segment.',
  segmentFilters: 'Add between 1 and 10 filters.',
  segmentField: 'Choose a field to filter on from the list.',
  segmentOperator: 'Choose a comparison that works with this field.',
  segmentValue: 'Choose or enter a value that fits this field, such as a date like 2026-11-16.',
  importColumn: 'Choose a column number from 1 to 50.',
  importField: 'Choose a field from the list for each column you import.',
  importRequired: 'Choose a column for every required field.',
  duplicateChoice: 'Choose whether to skip possible duplicates or add them as new records.',
  externalSystem: 'Choose the other system: Twenty, Salesforce or other.',
  externalId:
    'Enter the id from the other system: up to 100 letters, numbers, dots, hyphens, underscores or colons.',
  externalUrl: 'Enter a link that starts with https://, with no user name or password in it.',
} as const;

/** What each import row error says, to fix the file and upload it again. */
export const importRowMessages = {
  required: 'Fill in this field in the file.',
  too_long: 'Shorten this value in the file.',
  not_valid: 'Correct this value in the file so it is in the expected format.',
  not_in_list: 'Change this value in the file to one from the list of allowed values.',
  hidden_characters: 'Remove line breaks and hidden characters from this value in the file.',
  formula: 'Remove the =, +, -, @ or tab at the start of this value in the file.',
  repeated_in_file: 'Remove the repeated row from the file.',
} as const;

/** What each of party's merge conflicts says, for the preview and a refused confirm. */
export const mergeConflictMessages = {
  self_merge: 'Choose two different records to merge.',
  kind_mismatch: 'Choose two organisations or two people to merge.',
  party_merged: 'One record is already merged. Merge with the record it was merged into.',
  party_erased: 'One record has been erased. Choose records that have not been erased.',
  survivor_not_active: 'Choose an active record to keep.',
  both_have_accounts:
    'Both people have accounts, so keep both records until one of the accounts is closed.',
  account_on_loser: 'Keep the record of the person who has an account: swap which record you keep.',
  identifiers_both_verified:
    'Both organisations have different verified numbers of the same type, so keep them as separate records.',
  loser_identifier_verified:
    'Correct the number on the record you keep, or swap which record you keep.',
  module_refused: 'Another tool could not move its records. Check its records, then try again.',
  module_unregistered: 'Another tool is not ready to move its records. Contact support.',
  rows_changed: 'Some records changed since the merge. Move them back by hand, then try again.',
} as const satisfies Record<MergeConflict, string>;

export type CrmMessage =
  | (typeof crmMessages)[keyof typeof crmMessages]
  | (typeof importRowMessages)[keyof typeof importRowMessages];

/** A refinement's options, for a message from the lists above. */
export function says(message: CrmMessage) {
  return { error: message, params: catalogueParams };
}
