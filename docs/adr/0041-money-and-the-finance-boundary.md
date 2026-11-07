# ADR 0041: Money and the finance boundary

- **Status:** proposed
- **Date:** 2026-10-27
- **Deciders:** Aaron Gardner

## Context

Money already runs through the platform. Rounds have a budget and an award
range, decisions carry an award amount, and the 360Giving export and the
warehouse's `commitment` table publish both. On 3 October 2026 one money
shape was accepted for every contract, table, export and warehouse column:
an integer amount in the currency's minor unit with its ISO 4217 code
([ADR 0016](0016-modular-suite-and-shared-warehouse.md), "Names and shared
types"). It lives in `packages/domain/src/platform/money.ts` as
`moneySchema` (`{ amountMinor, currency }`), with `currencies = ['GBP']`
and `formatMoney()`.

The suite will soon do more with money. `finance` (wave 2, June 2027) turns
approved awards into payments and ledger entries, beside post-award
agreements, instalments and recoverable grants. Later, `funds`,
`fundraising` and `membership` bring income, donations and receivables.
[V1-PLAN](../V1-PLAN.md#out-of-scope-for-v1) keeps agreements, payment
schedules and finance exports out of V1, so this ADR adds no V1 work. It
fixes, before any finance code is written:

- the rules every amount follows, which every later finance task is
  reviewed against;
- what `finance` is (an integrator), and what the service will never become
  (a ledger, a holder of money, a card processor or a payment institution).

What is in place:

- Columns: `grants.round` has `budget_minor`, `award_min_minor` and
  `award_max_minor`, and `grants.decision` has `amount_minor`. Each is
  `bigint` with `CHECK (… BETWEEN 1 AND 100000000000)`, beside a `currency`
  column checked to `'GBP'`. The contracts share that bound as
  `MAX_AMOUNT_MINOR` in the grants programme inputs.
- `moneySchema` checks only that `amountMinor` is an integer. Zod's `int()`
  also limits it to a safe integer, but it allows zero, negatives and
  anything up to `Number.MAX_SAFE_INTEGER`.
- `assure`'s registry contract reuses the shape for figures copied from a
  charity's filed accounts, which may be zero.
- A round's awarded total is summed in code on the decisions page.
- [ADR 0038](0038-workflow-and-approvals.md) gives `finance` its approvals
  (two named people for a payment run) and leaves to this ADR whether
  payments need a longer audit floor.
  [ADR 0031](0031-registry-lookups-and-sanctions-data.md) screens payees
  against the UK sanctions list before the first live payment.

Facts about regulation below rest on general knowledge where marked (GK).
They are for the solicitor, and the accountant where it says so, to confirm
before `finance` handles a live payment.

## Options considered

How an amount is held:

1. **An integer of the minor unit with an ISO 4217 code.** Exact, the same
   in TypeScript, JSON and PostgreSQL, and already decided for MVP1. Needs a
   cap so sums stay exact in JavaScript numbers.
2. **A decimal: `numeric` in the database and a string in JSON.** Exact,
   but every contract would parse and compare strings, and every module
   would need a decimal library to add them up.
3. **A float.** Rejected: binary fractions cannot hold most amounts in pence
   exactly.
4. **`bigint` throughout, as JavaScript `BigInt`.** Exact at any size, but
   JSON cannot carry a `BigInt`, so each contract would encode it as a
   string. A cap far inside the safe-integer range gives the same exactness
   with plain numbers.

What `finance` is:

5. **A ledger inside the product:** double-entry books, VAT and fund
   accounting. Funders already keep books in an accounting package their
   auditors know, so a second set would have to be reconciled with it.
   Building and certifying it is a product of its own.
6. **An integrator.** The customer's ledger stays the book of record.
   `finance` maps approved awards and payments to it, posts them and reads
   their status back.

How money leaves the funder:

7. **Hold or move funds ourselves,** through a client money account or by
   submitting Bacs as a bureau. That needs authorisation as a payment
   institution or bureau approval, safeguarding of client money and audits
   (GK). Rejected.
8. **The funder's own bank does it.** We produce a payment file the funder
   uploads to its bank, or instruct a regulated payment initiation provider
   to pay from the funder's own account with the funder's authorisation.
   The money never passes through us.

Card payments (incoming, from Q2 2027):

9. **Card fields on our own pages,** or a provider's script on our page that
   reads them (PCI DSS SAQ A-EP or D, GK). Our origin and servers would then
   be in scope for card data.
10. **Hosted payment pages or a full redirect only** (SAQ A, GK). The card
    is typed only on the provider's page; we receive a reference and a
    status.

## Decision

Options 1, 6, 8 and 10. Decided: this ADR is the proposal for the finance
boundary (decision 6 of the suite roadmap, due 18 December 2026): `finance`
integrates with ledgers and regulated providers, and we never build
anything on the list below.

### One money type

- `packages/domain/src/platform/money.ts` is the one money type. Every
  amount in every contract, table, export and warehouse column is a
  whole number of its currency's minor unit (pence for GBP) with its ISO
  4217 code beside it. No module defines its own money type.
- No floats, decimals or strings hold an amount anywhere it is stored,
  compared, summed or sent to another system. Where an outside format wants
  a number in major units, such as the 360Giving export or a ledger's API,
  the conversion happens once, at the edge, by dividing by the currency's
  minor units. Within the cap a double holds every such result exactly, so
  it prints exactly. An incoming decimal is parsed into minor units by
  integer arithmetic, and refused if it has more decimal places than the
  currency has minor digits. `formatMoney()` divides for display only.
- No arithmetic across currencies: adding, comparing or splitting two
  amounts in different currencies is refused, in code and in SQL, where
  totals are grouped by currency. No exchange rate is held, fetched or
  applied. The product never converts; a ledger that does keeps its own
  rates.
- GBP is the only currency until a design partner needs another. Adding
  one means adding its code and minor digits to `money.ts`, and widening
  each `currency` CHECK by migration. A programme's currency is fixed once
  set, as it already is.
- The warehouse carries `…_minor` and `currency` columns, never converted
  or pre-formatted values.

### Amounts are positive and capped

- One platform cap: an amount the service records or acts on is a positive
  integer no larger than 100,000,000,000 minor units (£1bn in GBP). This is
  the bound the round and decision columns already use. The cap counts minor
  units, so a currency with other minor digits gets a different cap in
  major units; adding such a currency revisits it.
- Direction is carried by the kind of record, never by the sign: a payment
  and a repayment are both positive amounts on different records, and so
  are an increase and a decrease in a variation. Zero is not an amount: a
  zero award is a decline.
- Enforced twice:
  - by the shared schema, which the server uses to re-validate every input
    ([rule 6](../ARCHITECTURE.md));
  - by every money column: `bigint`, `CHECK (… BETWEEN 1 AND
100000000000)`, with a `currency` column checked to the allowed codes,
    and both set or both null.
- `moneySchema` today checks only for a safe integer. A later lead contracts
  task adds the cap to the shared schema and moves `MAX_AMOUNT_MINOR` from
  the grants contracts into `money.ts`. This ADR changes no code.
- **Figures we report but never act on**, such as a charity's filed income
  from a register (ADR 0031), use the same shape with their own bounds: zero
  or more, and a safe integer, since a large charity's income can exceed
  £1bn. They never feed a commitment, an instalment or a payment.

### Totals and splits

- **Totals are computed in the database** wherever they come from stored
  rows: `sum()` over `bigint` returns PostgreSQL's exact `numeric`. The
  server converts the result with a safe-integer check and refuses with an
  error code if it would not fit, rather than lose precision. One amount is
  at most 10^11 and `Number.MAX_SAFE_INTEGER` is about 9 × 10^15, so a
  total overflows only past about 90,000 amounts at the cap.
- **Totals in code** (over a page of rows, say) go through one helper in
  `money.ts` that checks the currency of every amount and
  `Number.isSafeInteger` after every addition. Differences, such as how far
  awards are over budget, are computed values, may be negative, and are
  never stored as amounts.
- **Splitting an amount** (instalments) is one function in `money.ts`: each
  part is the total times its share, rounded down by integer arithmetic
  (shares as whole numbers, such as basis points; at the cap the product
  is at most 10^15). The remainder is then
  added one minor unit at a time to the parts in order, starting with the
  first. Every part must be positive, and the parts must add up exactly to
  the total. Equal splits use the same rule, so £100.00 in three parts is
  £33.34, £33.33 and £33.33.

### No ledger

- The customer's ledger is the book of record: Xero first, then Sage
  Intacct and QuickBooks Online (GK). `finance` maps awards, payments and
  receivables to the ledger's accounts and tracking categories, posts bills,
  payments and journals to it, and reads payment status back.
- There are no double-entry books, general ledger, chart of accounts,
  VAT records or fund accounting books in the product. VAT stays in the
  ledger. Restricted and unrestricted funds are mapped to the ledger's
  tracking categories, not kept as balances of our own. Recoverable grants
  are tracked as receivables in the ledger, with no lending engine.
- What the ledger says about a payment (posted, paid, failed) is read back
  and shown; we never compute a balance to compete with it.

### No funds held

- The service never holds, receives or moves anyone's money. Payments go
  out either:
  - in a payment file the funder downloads and uploads to its own bank; or
  - through a regulated payment initiation provider that pays from the
    funder's own account, with the funder's authorisation at the provider.
- So the operator is neither a payment institution nor a Bacs bureau, and
  holds no client money (GK; for the solicitor to confirm, with the
  payment services regulations, before the first live payment).
- The format of the payment file, its protection, who may download it and
  how long it is kept go with payee bank details in ADR 0043 (payee bank
  details and payment controls, being drafted).

### Card data: SAQ A only

- Card data never enters our origin, servers, logs, database or backups.
  Incoming payments (a Q2 2027 ADR) use a provider's hosted payment page or
  a full redirect to it, never fields or scripts of the provider's on our
  pages. This keeps the operator in the smallest PCI DSS scope, SAQ A (GK).
- Staff never type in card details, including donations taken by phone.
  A phone donor is sent the provider's page, or the funder uses the
  provider's own terminal outside the product.
- No route or column is built to accept a card number. Card numbers are
  added to the patterns the redacting logger removes, as a second guard.

### Regulated providers

- Payment initiation, Confirmation of Payee, card and Direct Debit providers
  and ledgers are integrations. Each is a separate provider with its own
  contract and data protection terms, recorded in the record of processing
  before it is used.
- Calls to them go through the global dispatcher
  ([ADR 0010](0010-authentication-security-rules.md), "Outbound requests").
  A larger download uses a client pinned to its configured host, as ADR
  0031 does. Their credentials are stored encrypted with a key version, as
  ADR 0010 stores SSO secrets.
- Their callbacks follow
  [ADR 0040](0040-esignature-and-document-generation.md) (e-signature and
  document generation): an
  opaque reference with no tenant in the address, an approved definer
  function to find the tenant, a signature checked over the raw body, and
  the body treated as a hint that the worker checks with the provider.
- No provider is called from the browser, and no provider's script runs on
  our pages except a redirect to its hosted page.

### Humans decide

[Rule 9](../ARCHITECTURE.md): no code path awards or pays without a named
user action.

- A payment run needs two distinct named approvers through ADR 0038's
  separation of duties, neither of them the person who made the run. The
  count is fixed in code; a tenant may raise it but never lower it.
- Every action that moves money, or decides where it goes, needs step-up
  re-authentication within 5 minutes (ADR 0010, ADR 0038): approving a run,
  releasing its payment file or provider instruction, and changing payee
  bank details.
- An instalment falling due puts it in front of a person. Nothing is paid
  on a schedule, a webhook or a ledger status alone.
- Sanctions screening before payment comes from ADR 0031. Matches are shown
  at approval, where a person decides; no code blocks or pays on a match.
- Payee bank details, their dual approval, Confirmation of Payee, the
  cooling-off period and the reused-bank-details check are left to ADR 0043.

### Retention floor for payments

Answering ADR 0038's question: payment records, payment runs, the approvals
they used and their audit events are kept for at least 7 years from the
payment date, a platform minimum no tenant can lower. Charities must keep
accounting records for 6 years from the end of the financial year they
relate to (Charities Act 2011, section 131; HMRC likewise; GK, for the
accountant to confirm). Seven years from the payment date always covers
that, whatever the funder's year end.

### What we will never build

These carry a regulatory status, a liability or an operational burden the
service cannot carry. We integrate with them instead:

- a general ledger, payroll or pensions;
- card handling of any kind, including staff typing in donations taken by
  phone;
- Bacs bureau or payment institution status, or holding anyone's money;
- a DBS umbrella body;
- lottery or raffle management;
- lending to individuals;
- e-tendering, housing management, or research pre-award costing;
- our own e-signature engine, email delivery infrastructure or AI model;
- third-party plugins running inside the managed service's own process.

### Not decided here

- Payee bank details and payment controls: ADR 0043 (being drafted).
- The workflow engine and its approvals: ADR 0038.
- Incoming payments, Direct Debit, reconciliation and the Gift Aid claim
  route: a Q2 2027 ADR.
- Further ledgers through plugins: ADR 0044 (plugin API v1, being drafted).

## Consequences

- Rule 1, portable: amounts are plain `bigint` columns and JSON numbers; no
  cloud or database feature is involved.
- Rule 3, real constraints: every money column carries the cap and a
  currency CHECK. The schema lint can then require that any `…_minor`
  column is `bigint` with that CHECK and a sibling `currency` column, which
  a later db-security task adds.
- Rule 5, classification: amounts are internal. A payment file and payee
  bank details are personal at least, under ADR 0043.
- Rule 9: payments always pass two named approvers and a step-up; schedules,
  callbacks and ledger statuses only inform.
- The money helpers (the cap, a checked sum and the split) arrive in one
  lead contracts task before `finance` starts. Existing in-code sums, such
  as a round's awarded total, move to the checked sum then.
- Every finance task is reviewed against this ADR: an amount that is not
  `{ amountMinor, currency }`, a float, a sign used for direction, a card
  field, a balance of our own or an automatic payment is refused in review.
- Keeping the ledger elsewhere means a funder without one cannot use
  `finance` beyond payment files. That is acceptable: every funder we
  target keeps books.
- The regulatory points marked GK need written advice before the first live
  payment: payment services status, Bacs, PCI DSS scope and the retention
  floor.
- No dependency is added.
