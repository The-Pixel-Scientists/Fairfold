# ADR 0019: Tenant addresses, public pages and theming

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

Applicants reach a funder's portal before they have an account, and should
see that funder's name and look on the sign-in page. Funders set their look
(logo, brand colour and a few presets) without code, and it must keep WCAG
2.2 AA contrast. Three gaps in the accepted ADRs follow:

- [ADR 0010](0010-authentication-security-rules.md) sets the active tenant
  "from the sign-in URL", but nothing says how a URL names a tenant, and
  `app.tenant` can only be read once its id is the current tenant
  ([ADR 0003](0003-query-builder-and-migrations.md)).
- Nothing reads tenant data before sign-in, and ADR 0003 allows no tenant
  source for anonymous requests.
- Creating a tenant needs a tenant id that comes from none of ADR 0003's
  sources.

## Options considered

Public reads:

1. **Set the tenant from the URL for public routes.** Simple, but any public
   route could then read any of that tenant's data as `app_api`.
2. **A public role with column grants and its own policies.** Tight, but a
   new login role, credential and set of policies for two small reads.
3. **Approved definer functions that return only the public columns.** No
   tenant context is ever set for an anonymous request, and the function
   owners hold exactly the columns they return.

Logo files:

4. **SVG allowed.** Sharp at any size, but SVG can carry script.
5. **PNG and WebP only, checked by signature, stored in the database and
   served by the API.** No storage or scanning path needed for MVP1.

## Decision

Option 3 for public reads and option 5 for logos.

### Tenant addresses

- Each tenant has a slug, such as `northfield`: 3 to 40 characters of lower
  case letters, digits and single hyphens, starting with a letter. It is
  unique in the deployment, set when the tenant is created, and changed only
  by the operator.
- Console and portal URLs start with the slug (`/northfield/…`, after the
  base path on single-host installs). The slug is a public name the operator
  chooses, not personal data, so [ADR 0004](0004-api-contract.md)'s rule
  that URLs carry ids only does not apply to it.
- API paths never carry a slug, except under `/public/tenants/{slug}/` and
  the sign-in routes under `/auth/tenants/{slug}/`. Signed-in requests take
  the tenant from the session, as before.
- ADR 0010's "tenant named in a sign-in URL" is the slug, resolved through
  `app.public_tenant()`.

### Public pages

These join ADR 0003's approved definer functions:

| Function | Callable by | Returns | Its owner holds |
| --- | --- | --- | --- |
| `app.public_tenant(slug)` | `app_api`, `app_auth` | For an active tenant: id, name, brand colour, preset, and whether it has a logo; nothing otherwise | `SELECT` on `id`, `slug`, `name` and `status` of `app.tenant`, and on `tenant_id`, `brand_colour`, `preset` and `logo_type` of `app.tenant_theme`, each with a `SELECT` policy `TO` it that is `USING (true)` |
| `app.public_tenant_logo(slug)` | `app_api` | For an active tenant: the logo and its type; nothing otherwise | The same on `app.tenant`, and `SELECT` on `tenant_id`, `logo` and `logo_type` of `app.tenant_theme` |

- `/public/tenants/{slug}`, `/public/tenants/{slug}/theme.css` and
  `/public/tenants/{slug}/logo` use only these functions and set no tenant.
  An unknown, suspended or misspelt slug gets the same 404.
- Before sign-in the portal shows the tenant's name and look and asks the
  applicant to sign in or create an account. Listing open programmes before
  sign-in comes later, by adding a function in the same pattern.

### Creating a tenant

| Function | Callable by | Returns | Its owner holds |
| --- | --- | --- | --- |
| `app.create_tenant(slug, name)` | `app_worker` | The new tenant's id | `INSERT` on `id`, `slug` and `name` of `app.tenant`, with an `INSERT` policy `TO` it that is `WITH CHECK (true)` |

- Only the operator command (`pnpm tenant:create`) calls it, using the
  worker's credentials. ADR 0003's list of tenant sources gains a sixth: in
  that command, the id `app.create_tenant()` returned. A helper that only
  `apps/api/src/operator/` may import sets it, as `app_worker`, so the
  command can write the tenant's audit event and first invitation. A Semgrep
  rule bans the helper and the function anywhere else.

### Theming

- Tokens: a brand colour (`#rrggbb`), one of three presets that change only
  corner radius and surface tint, and an optional logo. Density stays fixed
  per app (ADR 0006).
- `packages/domain` checks a theme before it is saved, in the browser and
  again on the server. The brand colour and its derived hover shade each need
  at least 4.5:1 contrast with white, which covers white text on buttons and
  brand-coloured links on white. The derived tint must keep body text at
  4.5:1. Focus rings use a fixed token, not the brand colour. A failing
  colour is refused, with the nearest darker shade that passes suggested.
- The API builds `theme.css` from validated tokens only; no free text reaches
  CSS. The apps load it as a same-origin stylesheet, so the content security
  policy in ADR 0006 is unchanged.
- Logos: PNG or WebP, at most 200 KB and 1200 by 400 pixels, with the type
  and size read from the file's signature and header, never from its name or
  declared type. SVG is refused. The logo is stored in `app.tenant_theme`,
  served only by the API with its checked type and `nosniff`, and its
  alternative text is the tenant's name. It is not virus-scanned: it is only
  ever shown as an image with a fixed type, never offered as a download.
- A theme change needs the settings permission and writes a configuration
  version and an audit event. Everything else a funder changes is
  configuration, not theme.

## Consequences

- No anonymous request ever runs with a tenant set.
- ADR 0003's approved functions gain three rows and its tenant sources one;
  the roles script gains three `NOLOGIN` owners, and the catalogue test
  checks each owner's grants and policies.
- The sign-in, theme and logo routes need rate limits before the API faces
  the internet, as the other public routes do.
- A custom domain per tenant, and browsing programmes before sign-in, would
  each extend this ADR.

## Dependency check

No dependency is added. Image checks read the PNG and WebP headers directly.
