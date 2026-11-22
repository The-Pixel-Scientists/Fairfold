// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the platform says about signatures and generated documents, in the
// words of docs/CONTENT-STYLE.md: what went wrong and how to fix it. No
// message repeats a name, an email address, a file name or a field's answer.

export const documentsMessages = {
  signerTwice: 'Add each signer once.',
  orderTwice: 'Give each signer a different place in the signing order.',
  expiry: 'Choose an expiry date in the next 90 days.',
  mergeFieldsMatch: 'List each field the document uses once, and no others.',
  tableColumns: 'Give every row of the table one cell for each column.',
  bodyTooLong: 'Make the document shorter. Remove some blocks or text, then publish it again.',
  plainText: 'Remove line breaks and hidden characters from the text.',
} as const;

/** Each status in words, for staff screens. */
export const signatureStatusLabels = {
  draft: 'Not sent yet',
  sent: 'Sent for signature',
  viewed: 'Opened by a signer',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  failed: 'Could not be sent',
} as const;

/** What staff see about a failed request. A person decides what happens next. */
export const signatureFailureMessages = {
  signer_unavailable:
    'A signer can no longer be contacted, so nothing was sent. Check the signers and make a new request.',
  upload_mismatch:
    'The signing service did not receive the document as sent, so it was cancelled. Make a new request.',
  document_mismatch:
    'The signed document did not match the one sent, so it was not saved. Contact your administrator before you make a new request.',
  provider_unavailable:
    'The signing service could not be reached. We will check again automatically, so you do not need to do anything.',
} as const;

/** Why a template's field was refused at publish. */
export const templateFieldMessages = {
  unknown: 'This field is not a question on the form. Remove it from the template.',
  not_visible:
    "The people this document is for cannot see this field. Remove it, or change the document's audience.",
  restricted:
    'This field is only counted in reports and cannot go in a document. Remove it from the template.',
} as const;

/** Why a document was not made, stored as `document.<code>`. */
export const documentFailureMessages = {
  too_large: 'The document would be larger than 10 MB. Choose fewer records and try again.',
  field_not_released:
    'The document uses a decision that has not been released. Release the decision first, or remove the field from the template.',
} as const;
