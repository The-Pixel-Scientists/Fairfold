# Verify an identifier

An identifier is a registry number, such as a charity or company number. This
guide says what "verified" means, who may verify, and what changes afterwards.

## What verified means

- **Unverified**: someone typed the number. An applicant, a member of staff or
  an import may have typed it. Nobody has checked it.
- **Verified**: a named member of staff checked the number against the register
  and said so. CRM records who and when.

The registers CRM understands are:

| Code | Register |
| --- | --- |
| `GB-CHC` | Registered charity in England and Wales |
| `GB-SC` | Registered charity in Scotland |
| `GB-NIC` | Registered charity in Northern Ireland |
| `GB-COH` | Company registered with Companies House |
| `GB-MPR` | Society on the Mutuals Public Register |

CRM checks the shape of each number. The check for the Mutuals Public Register
is loose, because its numbers have changed form over the years. A shape check
does not prove that the number exists. Staff verification is the real check.

## Who may verify

A member with the right "Edit organisations and people, verify identifiers and
record relationships". A programme manager holds it. The verifier is always the
signed-in member. A request cannot name someone else.

The console has no verify button yet. Verification is an API route on the
organisation: "Record that you checked an identifier against its register".

## Check before you verify

1. Open the organisation and note the register and the number under
   **Identifiers**.
2. Open that register's public search in your browser: the Charity Commission
   for England and Wales, OSCR, the Charity Commission for Northern Ireland,
   Companies House or the FCA's Mutuals Public Register.
3. Search by the number. Check that the register's name and address match the
   organisation.
4. Only then call the verify route. If they do not match, leave the number
   unverified and correct the record.

CRM does not look numbers up for you.

## What changes once it is verified

- **It becomes unique in your funder.** Only one organisation can hold a given
  verified number. Verifying a number that is already verified on another
  organisation is refused: "This number is already verified on another
  organisation. Check the possible duplicates and merge them." The message does
  not repeat the number.
- **It can be published.** The warehouse column `org_id_verified` reads true. The
  360Giving export treats a recipient whose number is not verified as unverified
  and lists it in the export summary. See
  [Publishing to 360Giving](../../../docs/admin/publishing-360giving.md).
- **It can raise a stronger duplicate candidate.** Two records with the same
  number, where either is verified, show as "Same verified number", a strong
  match. See [Duplicates and merging](duplicates-and-merging.md).

Verifying an identifier writes the audit event `party.identifier.verified`.

## What an applicant sees

Applicants never see whether a number is verified. The portal returns no
verification status.

When an applicant types a charity or company number:

- it never links them to an organisation that already exists;
- it never tells them whether a record with that number exists;
- it never stops another applicant using the same number, because only a
  verified number is unique.

A typed number can only give staff a possible duplicate to look at. Nothing is
linked until a member of staff acts.

## Merging and verification

A merge moves a verification to the record you keep only while the member who
verified it is still active. Two different verified numbers of the same type
block a merge. See
[Duplicates and merging](duplicates-and-merging.md#when-a-merge-is-blocked).
