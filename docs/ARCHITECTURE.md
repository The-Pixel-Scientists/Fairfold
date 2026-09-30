# Architecture rules

These ten rules apply to every change to PixelGrant. They come from the
[V1 development plan](V1-PLAN.md#rules-the-team-must-hold-to) and the
[architecture decision records](adr/). A change that would break one of them
needs an ADR that names the exception and the guards that make it safe. There
are two such exceptions today, listed under rules 2 and 4.

1. **Portable.** Everything runs on vanilla PostgreSQL 16 or later in Docker.
   Application code uses no feature that exists only on Google Cloud or any
   other single cloud. Cloud-specific configuration lives only in
   `infra/terraform/`. The managed service runs on Google Cloud, and the same
   code must deploy to other UK and EU providers without changes.

2. **Tenant isolation by row-level security.** Every tenant-owned table has a
   `tenant_id` column and a row-level security policy. The application
   connects as a role without `BYPASSRLS`. Every new table ships with a test
   proving one tenant cannot read or change another tenant's rows.

   *Named exception:* the pg-boss job schema ([ADR 0009](adr/0009-background-jobs.md)),
   and only with its guards in place: payloads hold ids only, the tenant id
   comes from the transaction and is checked by the database, the API and the
   worker use separate roles, errors are stored as codes only, and every job
   column is classified.

3. **Real constraints.** Foreign keys are enforced, columns are NOT NULL where
   that is meaningful, and enumerations have check constraints. Foreign keys
   are never stored as text.

4. **Audit everything that matters.** State changes, decisions, permission
   changes and sensitive reads write an audit event. The audit table is
   append-only: the application roles have INSERT and SELECT only.

   *Named exception:* the retention purge ([ADR 0003](adr/0003-query-builder-and-migrations.md)).
   A single approved function deletes only rows past a `retain_until` date
   that the database sets itself, never below a platform minimum that no
   tenant can lower, and every purge writes its own audit event.

5. **Classify every field.** Every column is registered in the field
   classification map (`packages/db/classification.ts`) with a sensitivity
   level and a retention rule. Export, subject access requests, erasure and
   the warehouse feed all read it.

6. **The server is the source of truth.** The server re-validates every input
   with the shared domain package. The acting user always comes from the
   session, never from a request body or URL.

7. **Answers are keyed by stable field ids.** Applications pin the form
   version they were submitted against, so renaming a question never orphans
   an answer.

8. **Decisions are private until released.** Recording an outcome and telling
   the applicant about it are separate operations.

9. **Humans decide.** No code path may reject, award or pay without a named
   person's action.

10. **Configuration is versioned.** Every change to programmes, stages,
    rubrics, forms and templates creates a configuration version with its
    author and a diff.
