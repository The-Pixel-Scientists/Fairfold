# ADR 0043: Payee bank details and payment controls

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Aaron Gardner

## Context

Post-award and `finance` arrive in wave 2 (June 2027). They carry the first
money in the suite, and with it the most common fraud against funders:
changing a grantee's bank details so that a payment goes to someone else
(GK). [V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1) keeps payments out of
V1, so this ADR adds no V1 work. It fixes the controls before any finance
code exists, so that every finance task and its threat model are reviewed
against them.

What this builds on:

- **Money and the boundary.**
  [ADR 0041](0041-money-and-the-finance-boundary.md): amounts in minor
  units; no ledger, no funds held, SAQ A only; regulated providers through
  the dispatcher; a payment run approved by two distinct named people with
  step-up; payment records kept at least 7 years from the payment date. It
  leaves bank details, the payment file, Confirmation of Payee, the
  cooling-off period and the reused-bank-details check to this ADR.
- **Approvals.** [ADR 0038](0038-workflow-and-approvals.md): N distinct
  named approvers, the approver never the requester, checked by the policy
  module and again by the database; step-up within 5 minutes on every
  decision; approver eligibility rules that a module registers and that can
  only narrow who may decide. Encryption, the cooling-off period,
  Confirmation of Payee and notices belong to `finance`, not to the engine.
- **Secrets and outbound calls.**
  [ADR 0010](0010-authentication-security-rules.md): AES-256-GCM with the
  table, column, row id and tenant id as associated data and a key version
  on each value; keys derived per purpose with HKDF-SHA-256 from a mounted
  secret; one dispatcher for outbound HTTP that reaches only public
  addresses over HTTPS.
- **Erasure.** [ADR 0027](0027-erasure-across-modules-and-audit.md):
  erasure is a named human action; statutory retention that overrides it
  waits for a Q1 2027 ADR, and until then a tenant that must keep a record
  by law declines that part of the request outside the system.
- **Registry checks.**
  [ADR 0031](0031-registry-lookups-and-sanctions-data.md) moved the
  reused-bank-details check out of `assure` into wave 2 with `finance`.
- **Parties.** Payees are organisations or people in the party core
  ([ADR 0017](0017-bespoke-crm-party-core.md)); their contacts are read
  through its contract.
- **Classification.** Every column is registered with a sensitivity level
  and a retention rule (rule 5).

Facts about Confirmation of Payee, payment fraud and regulation below rest
on general knowledge where marked (GK). The wave 2 tasks and the solicitor
confirm them before the first live payment.

## Options considered

Storing bank details:

1. **Plain columns protected by row-level security only.** A backup, a
   database dump or a mistaken query exposes every account.
2. **Encryption in the database with pgcrypto.** The key would travel in
   SQL and could reach logs and `pg_stat_statements`.
3. **Encryption in the application, as ADR 0010 encrypts SSO secrets.** The
   key never reaches the database; a copied value fails to decrypt
   elsewhere.
4. **A cloud key management service holding the key.** Strong, but
   cloud-specific in application code, against rule 1. A deployment can
   still hold the mounted secret in one.

Approving a change:

5. **One approver.** One compromised or careless account is enough.
6. **Two distinct approvers, neither the requester, through ADR 0038.**
   Three people take part in every change.

Checking the account:

7. **No check.** Approvers rely on the documents alone.
8. **Confirmation of Payee through a regulated provider,** shown to the
   approvers as evidence.
9. **Confirmation of Payee that blocks or approves on its own.** Against
   rule 9, and a "no match" is often a harmless difference in the name
   (GK).

## Decision

Options 3, 6 and 8. Nothing is built now: `finance` builds these controls in
wave 2, and no finance code, schema or contract is added by this ADR.

### What a bank account is

- A payee bank account belongs to one payee party. It holds the account
  name, the sort code, the account number and, where the account needs one,
  a building society roll number. Later currencies and IBANs follow the
  same rules.
- Each change makes a new **version** of the account. A version is never
  edited. A version is `proposed`, then `approved`, `rejected` or
  `withdrawn`; an approved version becomes `active` when its cooling-off
  period ends, and `replaced` when a later version becomes active. Only an
  `active` version can be paid.
- A payment records the account version it pays, by a real foreign key,
  so the record of what was paid never changes when the account does.

### Encryption at rest

- The account name, sort code, account number and roll number are each
  encrypted in the application with AES-256-GCM and a random 96-bit nonce,
  with the table, column, row id, tenant id and key version as associated
  data, as ADR 0010 encrypts SSO secrets. A value copied to another row,
  column or tenant fails to decrypt.
- The key is derived with HKDF-SHA-256, for the purpose "payee bank
  details", from a mounted secret of its own, not the auth secret. A leak of
  one does not expose the other, and each rotates on its own. Each value
  records its key version; a rotation command re-encrypts every version
  and writes an audit event with the key version and count.
- Only `finance`'s bank details service decrypts, and a Semgrep rule bans
  its decrypt helper anywhere else. The API decrypts only for a reveal. The
  worker decrypts only for a Confirmation of Payee request, a payment file,
  a payment sent to a payment initiation provider at release, and the key
  rotation command. Nothing decrypts to fill a screen, list, export, email,
  event or the warehouse.
- Two values are kept beside the ciphertext so that the details are rarely
  decrypted: the last four digits of the account number, for display, and
  an HMAC-SHA-256 of the normalised sort code and account number, under a
  per-tenant key derived from the same secret, for the reused-details
  check. Neither can be turned back into the account.
- Every column is classified **personal**, including for organisations,
  since many payees are sole traders or individuals and the same columns
  serve them all.

### Reading bank details

- Screens, exports and the warehouse show only the last four digits of the
  account number, beside the version's id and status. The account name,
  sort code, full account number and roll number are never in a list, a
  search, a filter, an export, the warehouse or a response by default.
  Emails show the last four digits only, and events carry ids only
  ([ADR 0034](0034-event-outbox.md)).
- A named permission, `finance.bank_details.reveal`, with step-up within
  5 minutes, reveals one version's full details, the account name included,
  on that version's own page, for 60 seconds, never in a list. For a close
  match it also shows the name Confirmation of Payee returned. Each reveal
  is an audited sensitive read.
- Approvers of a change verify the details, so they must hold the reveal
  permission. `finance`'s approver eligibility rule (below) checks it.
- Audit events, job payloads, error codes and logs carry ids, statuses and
  codes only, never a sort code, account number, roll number or account
  name. The redacting logger also removes values shaped like a sort code
  and account number pair, as a second guard.
- No route takes bank details in a URL or query string, and the request
  logger never records the body of a bank details route.

### Dual approval with step-up

- A new account, and every change to one, is a request on a `finance`
  workflow definition with `movesMoney` and `approvers: 2`
  ([ADR 0038](0038-workflow-and-approvals.md)). A tenant may raise the
  count but never lower it.
- Two distinct named members approve, neither of them the requester, each
  with step-up within 5 minutes. One rejection closes the request. The
  policy module and the database both check this, as ADR 0038 decides.
- Whoever enters the details is the requester, whether a member of staff
  or the payee through the portal, and entering them needs step-up within
  5 minutes (ADR 0041). A change sent by email or letter is entered by a
  member of staff, who becomes the requester.
- Each approver records how the change was verified, from a fixed list of
  codes: a call to a phone number that was on record before the change was
  asked for, a meeting in person, or a confirmation from another of the
  payee's portal accounts that existed before the change. The email, letter
  or portal account that asked for the change is never a verification.
  Confirmation of Payee is shown beside it but does not count as one on its
  own.

### Cooling-off period

- An approved version becomes `active` only after a cooling-off period:
  3 working days from the second approval by default. A tenant may lengthen
  it but never shorten it below 2 working days, a platform minimum. A
  payee's first account, with no earlier version to replace, has the same
  period.
- At approval, `finance` sends a notice to the payee's existing contacts,
  read through the party contract: the contacts on record before the change
  was requested, never an address entered with the change. It is a
  transactional email under
  [ADR 0033](0033-consent-and-communications.md). It says that the details
  changed, shows the last four digits only, and tells the payee to contact
  the funder by the funder's own published phone number if they did not ask
  for it. It holds no link that approves, rejects or shows anything.
- During the period, any member with the approval permission can stop the
  version, which closes it as `withdrawn` with a reason code and an audit
  event. The previous version stays active until then.
- **Payment runs inside the period.** A run pins each payment's account
  version when the run is made, and pays only a version that is `active`.
  A payment whose payee has a version waiting in its cooling-off period is
  held: it leaves the run with the reason `bank_details_cooling_off`, and
  the run's approvers see the held payments before they decide. If an
  account changes after a run is made, every payment in it to that payee is
  held in the same way, and releasing the run's payment file is refused
  until a person takes them out of the run or remakes it. A run never pays
  a version its approvers did not see.

### Confirmation of Payee

- Each new version is checked through a regulated Confirmation of Payee
  provider, called by the worker through the dispatcher
  ([ADR 0010](0010-authentication-security-rules.md), "Outbound requests"),
  with the provider's credentials encrypted with a key version. The
  provider is a separate processor with its own contract, as ADR 0041
  requires.
- The result is stored as a code: `match`, `close_match`, `no_match`,
  `not_checked` (the account type or institution is not covered) or
  `unavailable`. For a close match, the name the provider returns is
  stored encrypted beside the version, like the details themselves.
- Approvers see the result code, and for a close match the returned name
  through a reveal. A `no_match` or `close_match` asks each approver to confirm that they have
  seen it, which is recorded with their decision. **No result approves,
  rejects or withdraws anything** (rule 9): a person decides.
- A provider that is down leaves the result `unavailable`; approvers may
  ask for a recheck. A later EU cell uses the EU's Verification of Payee in
  the same way (GK).

### Separation of duties

- Whoever entered or changed a version can approve neither that change nor
  any payment run that pays that version.
- At least one approver of a payment run that pays a version must not have
  approved that version. So the two people who approved a change can never
  approve, on their own, the run that pays it. Each payment to a version
  that no earlier run has paid is marked as a new account on the run, for
  its approvers to see.
- The policy module checks these rules through an approver eligibility rule
  that `finance` registers under ADR 0038, so the approve button is never
  offered to someone they exclude. The same rule requires an approver of a
  change to hold the reveal permission.
- The database checks them again: `finance`'s trigger, when a run's
  approval is used for its named action, refuses if any approver of the
  run's request is the requester of an account version the run pays, or if
  every approver of the run's request approved one of those versions. ADR
  0038's own checks already keep the requester of each change from
  approving it.
- Whoever made the run cannot approve it (ADR 0041).

### Reused bank details

- In wave 2 with `finance`, as ADR 0031 decided. When a version is
  proposed, its HMAC is compared with every other payee's versions in the
  same tenant. A match is shown to the approvers as advisory: "These bank
  details are also used by …", naming the other payee for those who may see
  it.
- It never blocks, approves or rejects, since a group of charities can
  share a treasurer's account. The comparison never crosses tenants.

### The payment file

- A payment file in the format the funder's bank accepts is made by the
  worker only after the run is approved, and only when a named member
  releases it with step-up (ADR 0041). The file is classified personal.
- It can be downloaded only by the member who released it, through the API,
  within 24 hours, after which it is deleted. Each download is an audited
  sensitive read, and the audit event holds the file's SHA-256. It is never
  emailed, and no copy is kept beyond the 24 hours; the payment records
  keep what was paid.
- A payment through a regulated payment initiation provider receives the
  details from the worker at release, through the dispatcher, and is
  authorised by the funder at the provider (ADR 0041).

### Retention and erasure

| What                                                           | Kept                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| An active version                                              | While the payee is active                                                                            |
| A replaced version that no payment used                        | 12 months after it was replaced                                                                      |
| A version that a payment used                                  | Until the 7-year floor of every payment that used it ends (ADR 0041)                                 |
| A rejected or withdrawn version                                | 12 months after it closed, then its details are deleted and its row keeps ids, status and codes only |
| Confirmation of Payee results and returned names               | As long as their version                                                                             |
| Payment files                                                  | 24 hours                                                                                             |
| Approval requests and decisions for a change, and audit events | 7 years from the change, the same floor as payments, since they are its evidence                     |

- Erasure under ADR 0027 deletes the details of every version that no
  payment used. A version that a payment used is evidence for an
  accounting record. Until the statutory retention ADR (Q1 2027) adds a
  basis that lets it outlive erasure, the tenant declines that part of the
  request outside the system, as ADR 0027 says, and the details stay
  encrypted and unrevealed.

### Audit

Audit actions, named when `finance` is built: a version proposed, approved,
rejected, withdrawn, activated and replaced; each reveal; each Confirmation
of Payee result; each reused-details match shown; each payment held for
cooling-off; each payment file made, released and downloaded; and each key
rotation. Values are ids, statuses, codes and hashes only.

### Abuse cases

| Case                                                   | What stops it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A compromised staff account changes bank details       | MFA and step-up to enter (ADR 0010); it cannot approve its own change; two other people must approve with step-up; the payee's existing contacts are told; the cooling-off period gives them time to answer; every step is audited                                                                                                                                                                                                                                                                                                                                                                                     |
| A spoofed payee email asks for a change                | Approvers must verify through a contact already on record, never the email; Confirmation of Payee often shows the new name does not match; the notice goes to the existing contacts, who did not ask for it                                                                                                                                                                                                                                                                                                                                                                                                            |
| Two members of staff collude                           | Two colluding approvers can approve a change that an honest member entered from a spoofed request, with a false verification code. They cannot pay it alone: the run needs an approver who neither entered nor approved the change, and who sees the payment marked as a new account. The payee's existing contacts are told and the cooling-off period gives them time to answer; the reused-details check may show the account elsewhere; the change, its verification codes and its approvers are in the audit log. Three colluding members can still pay it, stopped only by the notice and the cooling-off period |
| A change made just before a payment run                | The run pays only `active` versions; a change during the run holds that payee's payments; the payment file is refused until a person deals with them                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A stolen database backup                               | The details are encrypted with a key that is not in the database or the backup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A member who may see payees tries to read full details | Only the reveal permission with step-up shows them, one version at a time, audited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

These cases are the starting point for `finance`'s wave 2 threat model and
for the pen test of its surface.

### Not decided here

- The ledger connectors, payment runs' screens and the payment initiation
  provider: `finance`'s wave 2 tasks, under ADR 0041.
- Which Confirmation of Payee provider: chosen and contracted in the
  quarter before the build (Q4 2026 to Q1 2027), with its own dependency
  check.
- Statutory retention and legal hold: the Q1 2027 ADR.

## Consequences

- Rule 1: encryption is in the application with a mounted secret; any
  deployment can keep that secret in its own key store. The provider is an
  integration behind the dispatcher.
- Rule 2: every `finance` table for accounts, versions and results has
  `tenant_id`, row-level security and a cross-tenant denial test, and the
  reused-details comparison runs inside one tenant only.
- Rule 3: payments reference the account version they paid by a real
  composite foreign key; statuses and result codes are check constraints.
- Rule 4: changes, approvals, reveals, results and payment file downloads
  are audited with ids and codes only.
- Rule 5: every bank detail column is personal, with the retention rules
  above, which agree with ADR 0027 and ADR 0041.
- Rule 6: the requester and approvers come from the session; the database
  checks them again.
- Rule 9: no check, result or timer approves, rejects or pays. Two named
  approvers with step-up approve each change, and two approve each run.
- A legitimate change takes at least 2 working days to take effect, plus
  the time to find two approvers. Funders must plan for it; it is the price
  of the control, and the guides say so.
- Small funders need at least three members with finance permissions to
  change bank details, and a fourth, who neither entered nor approved the
  change, to approve each run that pays the new account. A funder with
  fewer cannot use payee changes in the product.
- ADR 0038 gains its first approver eligibility rule, from `finance`.
- The solicitor confirms the regulatory points marked GK, and the
  Confirmation of Payee provider's terms, before the first live payment.

## Dependency check

No dependency is added. AES-256-GCM, HKDF-SHA-256 and HMAC-SHA-256 come
from `node:crypto`.
