# ADR 0025: Party matching, merge and search

- **Status:** proposed
- **Date:** 2026-10-04
- **Deciders:** Aaron Gardner

## Context

[ADR 0017](0017-bespoke-crm-party-core.md) makes `party` the one record of
every organisation and person a funder deals with. It lets duplicates exist
on purpose: an identifier an applicant types is a claim, unique only once
staff verify it, so one applicant can never block another or learn that a
funder already knows a charity. It leaves verification, merging and a
history of values to the CRM. The CRM's first release (`crm` v1) and the due
diligence tool (`assure`) need four things settled first:

- how duplicate candidates are found;
- how two records are merged, and every module's references moved to the
  one that remains;
- how staff search for organisations and people, on vanilla PostgreSQL with
  no external engine;
- where the history of party values lives.

Constraints:

- A wrong merge can show one applicant's applications to another. Merging is
  security-critical, and a human decides it
  ([architecture rule 9](../ARCHITECTURE.md)).
- Modules own their schemas and reach each other through published contracts
  and keys ([ADR 0016](0016-modular-suite-and-shared-warehouse.md)). Party
  keys are referenced from other modules by composite foreign keys
  `ON DELETE RESTRICT`, and `crm` never changes party tables (ADR 0017).
- Everything runs on PostgreSQL 16 or later, with no extension we cannot get
  everywhere ([ADR 0003](0003-query-builder-and-migrations.md)). Each
  hosting phase's cell may use a different provider.
- No function is executable by `PUBLIC`, and the catalogue test lists every
  function an app role may execute (ADR 0003, "Checks").
- Search must respect the audience projection and scope rules, and URLs
  carry ids only ([ADR 0004](0004-api-contract.md)).
- Erasure across modules is being decided in ADR 0027 (being drafted), and
  registry and sanctions matching sources in ADR 0031 (being drafted). This
  ADR refers to them and decides neither.

## Options considered

Finding duplicates:

1. **Exact identifier equality only.** Safe, but misses every duplicate with
   no identifier, and most small groups have none.
2. **Named signals with fixed thresholds: identifiers, trigram name
   similarity and postcode,** computed in PostgreSQL with `pg_trgm`. Explainable
   to staff, portable, and cheap with an index.
3. **A matching library or service** (probabilistic record linkage).
   Better recall, but a dependency, scores staff cannot explain, and personal
   data sent to another process.

Merging:

4. **Delete the loser and rewrite every reference.** Leaves no trace, breaks
   every audit event and snapshot that names the loser, and cannot be
   undone.
5. **Keep the loser as `merged`, pointing at the survivor, and re-point
   every module's references through a contract in one transaction.**
   History stays readable, and a merge can be reversed from its record.
6. **Never re-point; resolve merged ids at read time.** No writes in other
   modules, but every query in every module must join through the merge
   map, and one missed join shows split or stale data.

Reversal:

7. **No unmerge; recovery from backup.** Simplest, but a restore loses
   everyone else's work since the backup, so in practice a wrong merge would
   stay.
8. **Unmerge from the rows the merge record lists.** More code, but a wrong
   merge is undone in minutes.

Search:

9. **`ILIKE` on names.** No extension, but no typo tolerance and no index
   for infix matches.
10. **`pg_trgm` for names and identifiers, and PostgreSQL full-text search
    with the `simple` configuration for longer text.** Contrib extension,
    present wherever PostgreSQL is.
11. **An external engine** (OpenSearch, Meilisearch, Typesense). A second
    copy of personal data outside RLS, and another service for every cell
    and every self-hoster to run and back up.

Installing the extension:

12. **In schema `public`, from a migration.** Migrations run as `migrator`,
    which cannot create extensions, and `public` is losing its `PUBLIC`
    rights.
13. **In a dedicated schema, from the database privileges script,** with
    `USAGE` on that schema granted only to the roles that need it.

Value history:

14. **A trigger on each party table.** Cannot miss a write, but the actor
    membership is not in the database's context (only the tenant is), and
    adding a second session setting widens ADR 0003's tenant context.
15. **A party table written by the party server in the same transaction as
    each change.** One writer, which already knows the actor.
16. **A `crm` table.** Breaks "crm never changes party tables", and history
    would stop when a tenant switches `crm` off.

## Decision

Options 2, 5, 8, 10, 13 and 15.

### Duplicate candidates

A candidate is a pair of parties of the same kind in one tenant that staff
may want to merge. It is a suggestion, never an action: nothing links,
merges or flags anyone because a rule matched.

Organisations are candidates when any of these holds:

- **Verified identifier.** One organisation's verified identifier has the
  same scheme and normalised value as another's identifier. Two verified
  rows cannot match, since ADR 0017 makes verified identifiers unique, so
  the other row is always a claim.
- **Claimed identifier.** Two unverified identifiers have the same scheme
  and normalised value. Shown to staff, ranked below a verified match; it
  never merges or links anything.
- **Name.** `similarity(a.match_name, b.match_name) >= 0.6`.
- **Name and postcode.** `similarity >= 0.4` and the same normalised
  registered postcode. A postcode alone is never enough: many organisations
  share a building, and a small group's postcode is often a home.

People are candidates when either holds:

- **Email.** The same email address, compared in lower case.
- **Name and organisation.** `similarity >= 0.6` on the normalised full name,
  and a current `contact_for` link to the same organisation. A name alone is
  never enough for people: many share one.

Normalisation is defined once, in `modules/party/src/contracts/`, beside the
identifier rules it already holds (`normaliseIdentifier`, the UK postcode
check). The party server stores its result in a `match_name` column on
`party.organisation` and `party.person` on every write, and normalises
search terms with the same function, so SQL never normalises and the server
and database cannot disagree. For a name:

1. Unicode NFKD, then remove combining marks, so `Caffi'r Ŵyl` and
   `Caffi'r Wyl` match.
2. Lower case, and `&` becomes `and`.
3. Every character that is not a letter or digit becomes a space; runs of
   spaces become one; the ends are trimmed.
4. For organisations only: a leading `the` is dropped, and so are trailing
   legal-form words from a checked list in the contracts (`limited`, `ltd`,
   `cyfyngedig`, `cyf`, `plc`, `llp`, `cic`, `cio`).

The thresholds are constants in the same contracts and reach SQL as query
parameters. Candidate queries use the trigram index through `OPERATOR(ext.%)`
at PostgreSQL's default threshold of 0.3, which the app never changes, then
filter with `ext.similarity()` at the thresholds above.

Changing the normalisation or a threshold is a contract change with its own
review. A changed normalisation recomputes `match_name` tenant by tenant
(ADR 0029, being drafted).

### Who sees a match

This restates and extends ADR 0017's rule that typing an identifier never
links anyone:

- Typing an identifier, a name or a postcode never links an applicant to an
  existing record, never tells them a match exists, and never changes what
  they can see. Their requests do the same work, and get the same response,
  whether or not a match exists.
- Candidates are computed when staff ask for them, not when an applicant
  writes, so nothing is stored or flagged on an applicant's request.
- Only staff with a party permission (`party.records.read`, or a stronger
  one) see candidates. Person candidates are sensitive reads and are
  audited.
- `assure`'s duplicate flags call the same party contract with the same
  rules. They are advisory: a flag asks staff to look, and never blocks,
  rejects or merges.
- An import (`crm` CSV import) that finds a candidate creates a new record
  and shows the candidate; it never merges.

### Merge

A merge is a named staff action in `crm`, with a permission of its own
(`crm.parties.merge`) and re-authentication within the last 5 minutes, as
for releasing decisions
([ADR 0010](0010-authentication-security-rules.md)). It has one survivor and
one loser, of the same kind.

`party.party` gains its merge state:

- `status` widens to `active | archived | erased | merged` (ADR 0017's list
  with `merged` added), still a `CHECK`.
- `merged_into uuid`, with a composite foreign key
  `(tenant_id, merged_into, kind)` to `party.party (tenant_id, id, kind)`, so
  the survivor is in the same tenant and of the same kind.
- `CHECK (status <> 'merged' OR merged_into IS NOT NULL)`,
  `CHECK (merged_into IS NULL OR status IN ('merged', 'erased'))` and
  `CHECK (merged_into <> id)`. A merged party always names its survivor, and
  only a merged party or an erased former loser keeps one (see "Erasure
  after a merge").
- No chains. A trigger, on every insert or update that sets or changes
  `merged_into`, refuses a target that is not `active`, and refuses to mark a
  party `merged` while other parties are merged into it. When a survivor is
  later merged itself, the executor first moves every party already merged
  into it to the new survivor, in the same transaction.

The loser keeps every row it has. Reads of a merged id resolve to the
survivor only through the party contract: a console route given a merged id
returns the survivor, marked as reached through a merge, and a portal route
answers as for an id that does not exist. Module code never follows
`merged_into` itself.

A merge is refused when:

- either party is `erased` or already `merged`, or the survivor is not
  `active`;
- the two are of different kinds;
- a conflict below says so.

### Re-pointing every module

Each module that holds party keys implements one server contract, whose
type is published in `modules/party/src/contracts/`:

```ts
interface PartyRepoint {
  readonly module: ModuleName;
  repoint(trx: Transaction, input: RepointInput): Promise<RepointResult>;
  restore(trx: Transaction, input: RestoreInput): Promise<RepointResult>;
}

interface RepointInput {
  readonly loserId: string;
  readonly survivorId: string;
  readonly kind: 'organisation' | 'person';
}
```

- The tenant comes from the transaction, never from the input
  ([ADR 0003](0003-query-builder-and-migrations.md)). The input holds ids
  and the party kind only. `RestoreInput` adds the rows to move back.
- `RepointResult` lists, for each table, the ids of the rows changed and
  each row's change code (`repointed`, `link_added`, `link_ended`,
  `verification_moved` or `merged_into_moved`); counts by table follow from
  it.
- An implementation re-points working references only. Records of what
  happened (consent, value history, snapshots, merge records, audit events)
  keep the ids they were written with.
- `apps/api` composes the modules and passes every module's implementation
  to party's executor. Party imports no other module. A database test reads
  the catalogue and fails if any module table has a foreign key to
  `party.party`, `party.organisation` or `party.person` and its module has
  no implementation, so a new reference cannot be forgotten.
- The executor locks both party rows `FOR UPDATE`, lower id first, then calls
  every implementation, party's own included, inside the request's
  transaction. Modules switched off for the tenant are called too: their
  data stays and returns when they are switched on (ADR 0016).
- Any failure, or any refusal, rolls the whole merge back. A module that
  cannot re-point without breaking one of its own constraints refuses with a
  code; it never deletes or rewrites history to make a merge fit.
- The merge screen's preview runs the same executor, so staff see the real
  counts, refusals and access changes before they confirm. It needs the
  same permission (`crm.parties.merge`) and the same re-authentication as
  the merge, since it shows both parties' details and who gains or loses
  which organisations. The executor runs inside a savepoint and the preview
  rolls back to that savepoint, not the whole transaction; it then writes a
  `party.party.merge_previewed` audit event (the two ids, the party kind and
  counts by table, never values) and commits. A preview is a sensitive read
  (rule 4), so it is never left without an audit trail.

The merge is recorded twice, both in the same transaction:

- `crm.merge_record`: kind (`merge` or `unmerge`), party kind, loser,
  survivor, the loser's status before the merge, the deciding membership,
  the time, and for an unmerge the merge it reverses. With it,
  `crm.merge_record_row`: one row per changed row, holding module, table,
  row id and change code. Both are append-only (`INSERT` and `SELECT` only
  for app roles). Row ids in other modules' tables cannot have foreign keys
  across modules (ADR 0016), so they are plain `uuid` columns, checked by
  the unmerge before it acts. Counts by table come from these rows. `crm`
  writes both from the executor's result: party never writes `crm` tables,
  and `crm` never writes party tables.
- An audit event, `party.party.merged` (or `party.party.unmerged`), holding
  the two ids, the party kind, the merge record id and counts by table: ids
  and codes only.

### Conflicts

Each conflict a re-point can meet is decided here:

- **Two linked accounts.** If both people have a `user_id`, the merge is
  refused. Moving or clearing either link would let one account see records
  that the other account's holder entered, and `user_id` is set only from
  the signed-in session (ADR 0017), never by staff. The person keeps both
  records until one account is closed (the account closure route belongs to
  the erasure work, ADR 0027). If exactly one person has a `user_id`, that
  person must be the survivor, so an account link never moves.
- **Duplicate `contact_for` links.** Where re-pointing would create a second
  current link between the same two parties, the loser's link is ended on the
  merge date instead and recorded as `link_ended`.
- **Contacts of a merged organisation.** The loser organisation's current
  contacts are not carried over by default. The merge screen lists each one,
  with what they would gain and lose; staff choose which become contacts of
  the survivor, and each choice is the audited "add a person to an existing
  organisation" action from ADR 0017, recorded as `link_added`. Unchosen links
  end on the merge date and are recorded as `link_ended`. A contact of the
  loser otherwise gains every application and record of the survivor, which is
  exactly the wrong-merge harm above.
- **Contacts of a merged person.** When the survivor has a `user_id`, the
  organisation rule applies. The preview lists each of the loser's current
  `contact_for` links, with the organisations, applications and records the
  survivor's account would gain through it. None is carried over by default:
  staff choose each link to carry over, and each choice is the audited "add a
  person to an existing organisation" action from ADR 0017, recorded as
  `link_added`. Unchosen links end on the merge date and are recorded as
  `link_ended`. Without this, one wrong match, such as a shared `info@`
  address typed by staff on a person with no account, would give an
  applicant's account every organisation of another person. Links move to the
  survivor automatically only when neither person has an account, because then
  no account gains anything.
- **Staff people.** A member of staff's person is linked to their account
  like anyone's, so the rules above apply. In addition, when the survivor's
  account holds a staff membership in the tenant (a current membership with
  any role other than `applicant`), no `contact_for` link is carried over:
  the screen says the survivor is a member of staff, and every current link
  of the loser ends on the merge date. A staff account never gains
  applicant-side rights through a merge; if a member of staff really is a
  contact for an organisation, staff add that link afterwards as its own
  audited action.
- **Identifiers.** A merge never drops or splits a verified identifier, and
  never leaves two identifiers of one scheme on the survivor:
  - a scheme only the loser holds: re-pointed, with its verification;
  - the same scheme and value on both: the survivor's row stays; if only the
    loser's is verified, the verification moves to the survivor's row
    (cleared on the loser's first, then set on the survivor's, so the
    verified-once index never sees two) and is recorded as
    `verification_moved`;
  - the same scheme, different values, both verified: refused, since two
    registers say these are two bodies;
  - the same scheme, different values, only the loser's verified: refused
    until staff correct the survivor's claim or swap survivor and loser;
  - the same scheme, different values, the loser's unverified: the loser's
    claim stays on the loser, and the screen lists it before staff confirm.
- **Consent.** Never re-pointed: consent rows are append-only. Both
  histories are kept, and the party contract reads the current state for a
  purpose and channel as the latest row across the survivor and every party
  merged into it, since each row is the same person's own choice. ADR 0033
  (consent and communications, being drafted) may tighten this; it does not
  loosen it.
- **Snapshots.** `party.organisation_snapshot` rows are never re-pointed.
  They are evidence of what was submitted, and keep naming the loser, whose
  row remains. The application that references a snapshot is re-pointed
  like any other reference.
- **Value history and audit events.** Never re-pointed. The party contract
  reads the survivor's history together with that of the parties merged into
  it.

### What contacts see afterwards

Access is never copied or cached. Scope rules read current `contact_for`
links on every request ([ADR 0004](0004-api-contract.md)), so after a merge
each person sees exactly what their current links and the re-pointed rows
give them, and after an unmerge the same is true again. The preview shows
staff, for each person whose access changes, which organisations they gain
or lose.

### Unmerge

A merge can be reversed by an unmerge, a named staff action with the same
permission and re-authentication:

- It runs only on the latest merge record that touches either party, and
  only while neither party is `erased`. Merges are undone in reverse order.
- Party's executor passes each module the row ids its merge recorded, and the
  module's `restore` moves back exactly those rows that still point at the
  survivor. If any no longer does (it changed since), the module refuses and
  the unmerge rolls back. Rows created on the survivor after the merge stay
  there.
- Party restores the loser's status, clears `merged_into`, ends the links the
  merge added, reopens the links it ended, moves verifications back, and
  restores any `merged_into` the merge moved.
- It writes a `crm.merge_record` of kind `unmerge` and a
  `party.party.unmerged` audit event.

When an unmerge is refused, the documented recovery is by hand: staff move
the changed rows with ordinary audited edits until the unmerge succeeds, or
leave the records merged. A wrong person merge that let an account see
another person's records is a personal data breach whatever the fix, and
the audit trail shows what was visible and when.

### Erasure after a merge

Erasing a survivor (ADR 0027) erases its personal data and that of every
party merged into it, their value history and snapshots included, since
they are the same data subject. An erasure request for a merged id resolves
to the survivor. An erased party cannot be merged or unmerged.

Every party merged into the survivor ends `erased`, like the survivor, and
keeps its `merged_into`, so the records stay linked and the merge record
still reads. The checks above allow exactly this: `merged_into` is set on a
`merged` party and may stay set on an `erased` one. The erasure engine
destroys the subject key (ADR 0027) of each party it erases, every former
loser included, not only the survivor's; `app.destroy_subject_key` refuses
a party that is not `erased`, so a loser left `merged` would keep its audit
values readable.

### Search

- **Terms travel in POST bodies,** never in URLs, query strings, logs, audit
  values or browser history. The console keeps a term in screen state, not
  in the address ([ADR 0014](0014-client-side-routing.md)). Problems never
  echo a term.
- **Names** match on `match_name` with a trigram GIN index
  (`ext.gin_trgm_ops`): `match_name LIKE '%' || term || '%'` or
  `match_name OPERATOR(ext.%) term`, ranked by `ext.similarity()`. The
  normalised term holds only letters, digits and spaces, so it cannot carry
  a `LIKE` wildcard.
- **Identifiers and postcodes** match exactly, after the contracts'
  normalisation, on B-tree indexes.
- **Longer free text** (notes, interactions, later tools) uses full-text
  search with the `simple` configuration, on a generated `tsvector` column
  with a GIN index. Stemming harms names and UK data includes Welsh, so no
  language configuration is used.
- **No `unaccent`.** Names are already folded by the shared normalisation;
  free text matches accents as typed. If that proves too strict, `unaccent`
  is another trusted contrib extension and would follow the installation
  rules below through a new ADR.
- **Classification.** `match_name` and every generated `tsvector` column are
  classified as their source column, with its retention rule: a person's
  `match_name` is personal, an organisation's is internal. Erasure clears
  them with their source: a generated column recomputes itself, and a
  `CHECK` keeps a person's `match_name` null when both names are.
- **Access.** Results respect the audience projection, scope rules, the
  module switch and blind review ([ADR 0004](0004-api-contract.md)): nobody
  searches a field they cannot see, the portal has no party search, and
  reviewers under blind review cannot search applicants. Search needs a
  party permission. Searches that return people are sensitive reads,
  audited with the result ids, never the term.
- **No external search engine.**

### Installing `pg_trgm`

`USAGE` on schema `ext` is the access control for the extension. The
function privileges inside `ext` are not relied on, because on a managed
database the script cannot always change them.

- The database privileges script creates schema `ext` and runs
  `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ext`. No migration
  creates, alters or drops an extension, so up, down and up in CI is
  unaffected, and a `down.sql` drops only its own indexes.
- **Ownership.** Schema `ext` and the extension belong to the role that runs
  the script. The extension's member objects (functions, operators,
  operator classes and the `gtrgm` type) belong to that role only when it is
  a superuser. When a role without superuser creates the trusted extension,
  as a managed database's administrator does, they belong to the bootstrap
  superuser: on `postgres:16.15-bookworm`, a database owner without
  superuser owned the extension it created, and all 31 functions belonged
  to `postgres`. On either path nothing in `ext` belongs to `migrator` or an
  app role, so no migration can change it.
- **Schema rights.** `PUBLIC`, `app_auth` and `app_queue` get no `USAGE` on
  `ext`, and nobody but its owner has `CREATE`. The script grants `USAGE` to
  `migrator`, `app_api` and `app_worker`. It owns the schema on every path,
  so these grants always take effect.
- **Function rights.** The script's loop that revokes `EXECUTE` from `PUBLIC`
  on every routine in every schema also covers `ext`, and the script grants
  `EXECUTE` on the functions in `ext` to `app_api` and `app_worker`. Where the
  script's role owns the functions, both take effect. Where the bootstrap
  superuser owns them, PostgreSQL only warns that no privileges could be
  revoked or granted, and `PUBLIC` keeps `EXECUTE`. That is tolerated in `ext`
  and nowhere else. A role without `USAGE` on `ext` cannot look the functions
  up by name: it gets "permission denied for schema ext" (checked on
  PostgreSQL 16.15). PostgreSQL does not promise that schema `USAGE` is a
  complete barrier, but these are invoker-rights C functions that compute
  trigrams from their arguments and read no table, so a role that reached one
  some other way would gain only a calculation it could do itself.
- `migrator` needs no `EXECUTE`: on PostgreSQL 16.15 it builds a
  `gin_trgm_ops` index with `USAGE` alone, while a query using the operator
  needs `EXECUTE` on its function.
- **Catalogue test.** It gains one named exception, for schema `ext`, and
  nothing else, and it checks the schema rather than function privileges:
  every object in `ext` belongs to extension `pg_trgm`; no function in it is
  `SECURITY DEFINER`; `USAGE` on it is held by exactly its owner, `migrator`,
  `app_api` and `app_worker`, never `PUBLIC`, `app_auth` or `app_queue`;
  `CREATE` on it by its owner alone; and `app_api` and `app_worker` can
  execute every function in it. `EXECUTE` held by `PUBLIC` is tolerated on
  functions in `ext` only; the rule that no function is executable by
  `PUBLIC` holds in every other schema. The reason: these are PostgreSQL's
  own invariant functions (31 functions and 10 operators in `pg_trgm` 1.6),
  not definer functions or our code, their privileges are not ours to set
  on every provider, and listing each in the test would be a list that
  grows with every extension version.
- Indexes and queries schema-qualify the operator class, operators and
  functions (`ext.gin_trgm_ops`, `OPERATOR(ext.%)`, `ext.similarity()`), so
  no `search_path` changes, and definer functions keep their pinned
  `pg_catalog, pg_temp` path.

The script refuses today unless it runs as a superuser. That check has to
change before the script can run on Cloud SQL, whose administrator role (a
member of `cloudsqlsuperuser`) is not a superuser. The change keeps the script
failing closed when its role cannot create schema `ext` or the extension, or
does not own `ext`.

`pg_trgm` is a trusted extension (PostgreSQL 13 and later), so a managed
database administrator without superuser can create it, with the ownership
described above. Where it is available:

- Vanilla PostgreSQL 16 in Docker: the official image ships it (checked on
  `postgres:16.15-bookworm`, version 1.6).
- Cloud SQL for PostgreSQL 16: on Google's list of supported extensions;
  the staging cell confirms it when the script first runs there.
- A cell on virtual machines at a UK or EU sovereign provider runs our own
  PostgreSQL image, so it has `pg_trgm`.
- Managed PostgreSQL at sovereign providers for hosting phases 2 and 3
  (for example Civo in the UK, and OVHcloud or Scaleway in the EU) commonly
  allow `pg_trgm` (GK).

### Value history

`party.value_history` is a party table, written by the party server in the
same transaction as each staff or applicant change to a party field:

- party id (composite foreign key to `party.party`), field id (a checked
  list such as `organisation.name` or `person.email`), the changed row's id,
  old and new value, source (`portal` or `staff`), actor membership, and the
  time from `clock_timestamp()`;
- append-only: app roles have `INSERT` and `SELECT` only, with restrictive
  `UPDATE` and `DELETE` policies (ADR 0003, rule 4);
- the old-value and new-value columns registered in the classification map
  ([architecture rule 5](../ARCHITECTURE.md)) as `personal`, the most
  sensitive class any party field has (no party field is special category),
  with the party's retention rule. The map is per column, and export,
  subject access, erasure and the warehouse feed read it per column, so the
  value columns are never registered as `internal` because organisation
  fields are. The field a row names can only lower what a consumer shows or
  exports, through an explicit rule in that consumer, never through the
  map;
- kept as long as its party. Erasure clears personal values as ADR 0027
  decides for append-only tables, with the same mechanism and function;
- read by `crm`'s timeline and record screens through the party contract.
  `crm` never writes it, so ADR 0017's "crm never changes party tables"
  holds.

ADR 0017's submission snapshot already records details as submitted. Value
history adds what changed between submissions, and who changed it.

## Consequences

- Architecture rules, restated for the work that builds on this ADR:
  - Rule 2: `party.value_history`, `crm.merge_record` and
    `crm.merge_record_row` are tenant tables with `tenant_id`, RLS and a
    cross-tenant denial test, like every new table.
  - Rule 3: composite foreign keys, including `merged_into`; `CHECK`s for
    every status, kind, field id and change code, and for the pairing of
    `merged_into` with `merged` or `erased`.
  - Rule 4: merges, merge previews, unmerges, verifications, carried-over
    contact links and value history writes are audited with ids, codes and
    field ids only, never values or terms.
  - Rule 5 for value history: its value columns are `personal` in the map,
    whatever field a row names.
  - Rule 5: every new column (`merged_into`, `match_name`, every value
    history and merge record column) is classified with a retention rule.
  - Rule 6: the actor comes from the session; the server re-validates merge
    and unmerge input with the shared contracts.
  - Rule 9: nothing merges or links automatically.
  - Rule 10 is not engaged: a merge changes data, not configuration, so it
    writes no `config_version`.
- `GET /console/organisations?search=` from the party contracts carries a
  term in a query string. The search contracts move it to a POST body before
  search grows to people.
- Each module's foreign key columns to party keys need an `UPDATE` grant for
  `app_api`, limited to those columns, so the re-point can run.
- A trigram index copies personal values into the index. Clearing the column
  removes the live entry; the old value remains in dead tuples until vacuum
  reclaims them, and in backups until they expire. Backups follow ADR 0011
  (backups, being drafted), and the erasure ledger from ADR 0027 is
  re-applied after any restore.
- Normalisation lives in one place, so a change there means recomputing
  `match_name` across tenants.
- New contracts entry points that build on this ADR (search, party additions
  and `crm`) import the zod jitless switch before anything else.
- Before a cell is placed with any provider, confirm with the provider that
  `pg_trgm` can be created and by which role, who then owns the
  extension's functions, and whether `EXECUTE` on them can be revoked from
  `PUBLIC`. The catalogue test passes either way; the answer is recorded
  with the cell.
- The database privileges script's superuser check has to change before it
  can run on Cloud SQL (hosting phase 1). Until then the script runs only
  where it has a superuser, which covers Docker and virtual machine cells.
- The erasure engine (ADR 0027) sets every former loser to `erased` and
  destroys its subject key, as well as the survivor's.
- Duplicates found by registry or sanctions data are ADR 0031's question,
  and consent rules after a merge are ADR 0033's; both build on the
  candidates and merge record here.

## Dependency check

No package is added.

| Component               | Version             | Licence    | Notes                                                                         |
| ----------------------- | ------------------- | ---------- | ----------------------------------------------------------------------------- |
| `pg_trgm`               | 1.6 (PostgreSQL 16) | PostgreSQL | Contrib module shipped with the server; trusted extension; no lockfile change |
| `unaccent` (not chosen) | 1.1 (PostgreSQL 16) | PostgreSQL | Trusted extension; not installed                                              |

The PostgreSQL licence is a permissive, OSI-approved licence compatible with
AGPL-3.0-or-later. Like PostgreSQL itself, the extension runs in the database
server and is not linked into our code
([ADR 0002](0002-licence-and-dependency-policy.md)).
