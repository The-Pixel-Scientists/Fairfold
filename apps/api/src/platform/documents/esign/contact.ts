// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signer's name and address, from the party module's contract (ADR 0017,
// ADR 0040): read when a request is made and again when it is sent, handed
// to the adapter for that one call and never stored, so an erased person's
// address is not kept here (ADR 0027).

import type { SignerContact } from '@pixel-scientists/domain/documents';
import { contactDetails } from '@pixel-scientists/party/server';

import type { Transaction } from '@pixel-scientists/db';

/** The address party gives an erased person. */
const ERASED_ADDRESS = /@erased\.invalid$/;

/** The person's contact, or null when they do not exist in this tenant or have been erased. */
export async function signerContact(
  tx: Transaction<unknown>,
  personId: string,
): Promise<SignerContact | null> {
  const contact = await contactDetails(tx, personId);
  if (contact === null || ERASED_ADDRESS.test(contact.email)) return null;
  return { name: contact.givenName ?? contact.email, email: contact.email };
}
