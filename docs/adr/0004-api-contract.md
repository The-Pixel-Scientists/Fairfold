# ADR 0004: API contract

- **Status:** proposed
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

The API is Fastify with an OpenAPI schema generated from code
([technical baseline](../V1-PLAN.md#technical-baseline)). The form engine and
validation in `packages/domain` run in the browser and on the server, and the
server re-validates everything. We need one contract that:

- gives the console and portal types and client-side validation;
- lets the server reject anything the client should have blocked;
- produces an OpenAPI document for funders, warehouse tools and the Phase 2
  plugin API;
- makes every change to the API visible in review.

The acting user and tenant always come from the session, never from a body or
URL. Blind review means the API must never send a field the caller may not
see, and decisions stay private until released. A permission check alone is
not enough: a reviewer may read reviews, but only for applications assigned
to them.

## Options considered

1. **Zod schemas in `packages/domain`, fastify-type-provider-zod, OpenAPI from
   @fastify/swagger.**
   - Pros: one schema gives types, browser validation, server validation and
     OpenAPI. Zod 4 converts to JSON Schema natively. Zod is the common choice
     for form validation, so the form engine and API speak one language.
     Responses are encoded through their schema, so undeclared fields are
     dropped rather than sent.
   - Cons: the type provider is a small community package; most of its 2026
     commits are automated dependency bumps. Transforms and custom
     refinements do not show in OpenAPI. Zod adds weight to the portal
     bundle.
2. **TypeBox with @fastify/type-provider-typebox.**
   - Pros: JSON Schema is the native format, so Fastify validates and
     serialises at full speed. Maintained alongside Fastify.
   - Cons: less natural for form validation and messages in the browser. The
     library moved to a new package name for 1.0 (`typebox`), so examples are
     split across two APIs. The provider last released in October 2025.
3. **tRPC or oRPC.**
   - Pros: end-to-end types with little ceremony.
   - Cons: tRPC is RPC-first, and OpenAPI needs an add-on. oRPC produces
     OpenAPI but brings its own server layer over Fastify. Both shape the API
     around our frontends rather than external consumers.
4. **OpenAPI written first, clients generated with openapi-typescript.**
   - Pros: the document is the contract.
   - Cons: two sources of truth, the spec and the domain validation, which
     drift. ts-rest, a contract-first alternative, has not released since
     March 2025.

## Decision

Option 1.

Contracts:

- Route contracts live in `packages/domain/src/api/`. Each is a plain object:
  method, path, params, query, body, responses by status code, the permission
  it needs, and a resource-scope rule, such as "assigned reviewer with no
  declared conflict" or "applicant who owns the application". Request
  schemas are strict objects, so unknown keys are rejected.
- The API registers routes from these contracts with fastify-type-provider-zod's
  validator and serialiser compilers. One policy module in the API enforces
  every permission and scope rule; handlers do not check access themselves.
- A test fails if any route lacks a permission or a scope rule. Every route
  has a test that tries another user's object in the same tenant and expects
  the same response as for an object that does not exist.

Responses by audience:

- The portal, reviewers and staff have separate response contracts, even
  where fields overlap. A staff schema is never reused for another audience.
- Answers never pass through as stored. A server-side projection builds them
  from the application's pinned FormVersion and the viewer's role: it drops
  fields the version hides from reviewers when the viewer is a reviewer, and
  any field the role may not see.
- Portal contracts carry no decision fields (outcome, amount, feedback) until
  `released_at` is set. The status mapping shown to applicants never implies
  an outcome before release: an application is "Submitted" or "Under review"
  until its decision is released.
- Filter, sort and search inputs are checked against the same projection as
  responses, so nobody can filter, sort or search on a field they cannot
  see. A test tries each hidden field.
- History, attachment metadata (including file names), notes and messages
  go through the audience projection too.
- Email templates may use only fields released to the recipient: those the
  recipient's audience contract allows, and decision fields only once
  released. A template naming any other field is refused when saved, and a
  send that would fill one fails.
- Responses are encoded through their schema, so undeclared fields are
  dropped, and a test proves it. Another test walks every response schema and
  fails on `z.any`, `z.unknown`, `z.looseObject`, `.passthrough()` or a
  record with unknown values, except inside the answers projection.

Identity, URLs and logs:

- Schemas never contain an acting user or tenant id. A test fails if
  `tenantId`, `userId`, `actorId` or `createdBy` appears in any params, query
  or body schema.
- URLs carry ids only: no names, email addresses or other personal data in
  paths or query strings.
- The request logger redacts the `cookie`, `set-cookie` and `authorization`
  headers and, on auth routes, the query string and any token in the path:
  reset tokens, OIDC `code` and `state`, and SSO completion handles.

Errors:

- Errors use problem details (RFC 9457). Validation errors list the stable
  field id and a plain-English message from the domain package, following the
  [content style guide](../CONTENT-STYLE.md).
- Problem details never echo a submitted value, a stack trace, a constraint
  name or any other database detail.

OpenAPI and clients:

- @fastify/swagger builds the OpenAPI document with the provider's
  `jsonSchemaTransform`. It is committed as `apps/api/openapi.json`, and a
  Vitest `toMatchFileSnapshot` test fails when the API changes without it.
  API changes therefore show up as a readable diff.
- The console and portal call the API through a small typed helper,
  `call(contract, input)`, in `packages/domain`. No code generation for our
  own apps. Others can generate clients from `openapi.json`.
- API schemas stick to what JSON Schema can express. Refinements that it
  cannot express are documented in the schema description.

## Consequences

- The tech lead lands each contract in `packages/domain` before the endpoint
  and screens that use it are built, as with other shared contracts.
- Three response contracts per resource is more code than one. In return,
  blind review and private decisions are properties of the types, checked by
  tests, rather than something each handler must remember.
- Reviewers look at `openapi.json` diffs to spot breaking changes. Once
  external clients exist (Phase 2), a breaking change needs a new version
  path.
- We watch the portal bundle. If Zod's size hurts on slow connections, the
  portal can use `zod/mini` with the same schemas.
- If fastify-type-provider-zod is abandoned it is small enough to fork and
  maintain ourselves.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| zod | 4.6.5 | MIT | 2026-09-13 | Active; 44k stars |
| fastify | 5.12.5 | MIT | 2026-09-16 | Active; includes the 5.12.1 fixes for proxy header spoofing and schema bypass |
| fastify-type-provider-zod | 7.0.0 | MIT | 2026-06-24 | Needs fastify 5.5+, zod 4.1.5+, @fastify/swagger 9.5.1+; 590 stars |
| @fastify/swagger | 9.8.1 | MIT | 2026-07-13 | Active; 9.9.0 is too new |
| typebox (not chosen) | 1.3.34 | MIT | 2026-09-18 | GitHub reports the licence as NOASSERTION; npm says MIT |
| @fastify/type-provider-typebox (not chosen) | 6.1.0 | MIT | 2025-10-19 | Fastify organisation; no release for 11 months |
| @trpc/server (not chosen) | 11.19.0 | MIT | 2026-09-16 | Active |
| @orpc/server (not chosen) | 1.15.4 | MIT | 2026-09-23 | Active |
| openapi-typescript (not chosen) | 7.13.0 | MIT | 2026-02-11 | Active repository |
| @ts-rest/core (not chosen) | 3.52.1 | MIT | 2025-03-04 | Stalled |
