# ADR 0042: Brand architecture

- **Status:** proposed
- **Date:** 2026-11-18
- **Deciders:** Aaron Gardner

## Context

The suite is many tools that share one platform, one party core and one
warehouse ([ADR 0016](0016-modular-suite-and-shared-warehouse.md),
[ADR 0017](0017-bespoke-crm-party-core.md)). Each tool needs a name people
can find and trust, and the suite needs a name that a trade mark can
protect, at a cost the project can carry.

What happened so far:

- The working name, PixelGrant, named one tool only.
- PixelSuite was screened on 3 October 2026 and rated high risk: two
  software businesses already trade under the name, and Google's PIXEL marks
  sit close to it. Adding a descriptor such as "Grants" does not help,
  because a trade mark office compares the distinctive part.
- Fairfold was screened low risk the same day and chosen as the parent
  brand, pending a trade mark attorney's clearance. Aaron reported on
  4 October 2026 that Fairfold had cleared. UK and EU filing and the domains
  have not started.
- [ADR 0021](0021-brand-neutral-identifiers.md) already keeps the brand out
  of code: identifiers use `tps`, npm packages use `@pixel-scientists`, and
  the interface reads every name it shows from
  `packages/domain/src/platform/brand.ts`.

Constraints: one registration to pay for and defend; names a charity finance
manager or trustee understands at once; addresses that agree with
[ADR 0019](0019-tenant-addresses-public-pages-and-theming.md)'s tenant
addresses and [ADR 0035](0035-embeds-and-custom-domains.md)'s separate embed
site; and a rebrand, if one is ever forced, that touches no code identifier,
schema or stored data.

Trade mark and cost points below rest on general knowledge (GK) and are for
the attorney to confirm.

## Options considered

The brand:

1. **A brand per tool**, under a parent. Each needs its own clearance,
   filing and domains: roughly £36,000 to £96,000 across the suite (GK), and
   a reader cannot tell the tools belong together.
2. **One parent brand with a plain descriptor per tool**, such as
   "Fairfold Grants". One clearance and one filing (roughly £2,000 to £4,500
   for the UK and EU, GK). Descriptors are ordinary words, need no
   registration and can change without a filing.
3. **One parent brand with coined tool names.** Distinctive, but every
   coined name needs its own clearance, and none says what the tool does.

Domains:

4. **Domains per tool.** Dozens of registrations to renew and defend, and
   more look-alike addresses for phishing.
5. **One defensive set for the parent only** (`.uk`, `.co.uk`, `.org.uk`,
   `.com`, `.org`), with tools as paths or subdomains. About £100 to £300 a
   year (GK).
6. **One domain only.** Cheapest, but leaves the obvious look-alikes to
   anyone who wants to send email as us.

## Decision

Options 2 and 5.

### One parent brand: Fairfold

- The suite is **Fairfold**. Each tool is "Fairfold" followed by a plain
  descriptor, a product name written with capitals, as in "Fairfold Fund
  Accounting".
- The descriptors, by working name, are these. They describe the tool, so
  they are not marks and need no clearance; a quick check against
  competitors' product names comes before each one is first used in public.

| Working name  | Product name                  |
| ------------- | ----------------------------- |
| `grants`      | Fairfold Grants               |
| `crm`         | Fairfold CRM                  |
| `dca`         | Fairfold Activities           |
| `finance`     | Fairfold Payments             |
| `funds`       | Fairfold Fund Accounting      |
| `assure`      | Fairfold Due Diligence        |
| `impact`      | Fairfold Impact               |
| `governance`  | Fairfold Governance           |
| `privacy`     | Fairfold Data Protection      |
| `insight`     | Fairfold Reporting            |
| `atlas`       | Fairfold Funding Map          |
| `forms`       | Fairfold Forms                |
| `engage`      | Fairfold Communications       |
| `assist`      | Fairfold Assistant            |
| `connect`     | Fairfold Integrations         |
| `fundraising` | Fairfold Fundraising          |
| `cases`       | Fairfold Case Management      |
| `volunteers`  | Fairfold Volunteers           |
| `people`      | Fairfold Recruitment          |
| `membership`  | Fairfold Membership           |
| `finder`      | Fairfold Bid Manager          |
| `passport`    | Fairfold Organisation Profile |
| `field`       | Fairfold Field App            |

- **The party core takes no descriptor.** `party` is always on and belongs
  to the platform (ADR 0017); people see it through the tools that use it,
  never as a product.
- The applicant portal, the front door every tool shares, is simply
  "Fairfold" once it serves more than one tool.
- The small tools take descriptors in the same way, such as "Fairfold
  360Giving converter".
- Three descriptors start with "Fund" (Fund Accounting, Fundraising, Funding
  Map). Each is its users' own term, so all three stay, but menus never list
  them next to each other.
- A descriptor can change later without any filing. A change is a text
  change in `brand.ts` and the docs, and keeps the working name.

### Domains for the parent only

- One defensive set for Fairfold: `.uk`, `.co.uk`, `.org.uk`, `.com` and
  `.org`. On 3 October 2026 the `.com` was registered by someone else with no
  site on it. Buying it is Aaron's call on price; nothing in the product or
  its docs depends on it.
- One domain of the set is the primary: it carries the website and the
  managed service's hosts. Aaron picks it when the set is claimed;
  `.org.uk` is the recommendation, as the address funders and charities
  expect.
- **Tools need no domains of their own.** A tool is a path: on the website
  (`/grants`, `/crm`), and in the console and portal after the tenant's
  slug, as ADR 0019 sets out. No tool, and no tenant, gets a subdomain.
- **Subdomains name apps and cells only.** Each cell
  ([ADR 0012](0012-hosting-targets-and-cells.md)) has its own console and
  portal hosts under the primary domain, named for the app and the cell,
  such as `console.uk.` and `portal.uk.`. A tenant is pinned to one cell, so
  its people use that cell's hosts. A later EU cell adds `eu.` hosts and no
  new domain.
- **The embed host is a separate site** (ADR 0035), so it cannot sit under
  the primary domain. It uses a second domain from the defensive set, with
  the same cell naming. No domain outside the set is needed.
- Custom domains per tenant stay deferred, as ADR 0035 decided.
- Email the service sends uses a subdomain of the primary domain, with SPF,
  DKIM and DMARC at `p=reject`. Every other domain in the set publishes a
  null MX record and DMARC `p=reject`, and redirects its website to the
  primary, so the set cannot be used to send email that looks like ours.
- Self-hosted installs use their own domains. The brand reaches them only
  as interface text. A trade mark policy for forks and self-hosters is
  Aaron's to publish once the UK filing is made.

### Clearance

- Aaron reported on 4 October 2026 that Fairfold had cleared. This ADR
  stays proposed until the attorney's written opinion is on file; Aaron
  accepts it only then.
- This ADR changes nothing public by itself. The README and the interface
  already say Fairfold. The UK filing (classes 9, 42, 35 and 41) follows
  clearance, and the EU filing follows within six months of it, which keeps
  the UK priority date (GK).

### If Fairfold fails

The fallback parent names, screened on 3 October 2026, are:

1. **Goodfold**: no use found, with `.org`, `.co.uk`, `.org.uk`, `.uk` and
   `.io` showing no DNS record; blander than Fairfold.
2. **Pixel Commons**: no product or organisation found, but Google's PIXEL
   marks remain the same obstacle as for PixelSuite. Used only if the
   attorney says those marks are not the obstacle.

A change of parent name changes only user-facing text: `suiteName` in
`brand.ts`, the few files ADR 0021 lists as holding the name as text
because they load before any script, the OpenAPI document regenerated from
`brand.ts`, the tests that check those strings, and the docs. The
descriptors carry over unchanged.

### Code stays brand-neutral

As ADR 0021 decided: package scope, module working names, schemas, table
and column names, permission names, audit actions, environment variables,
database names, PostgreSQL settings and rule ids keep their working names.
User-facing names come only from `brand.ts`. A new tool adds its descriptor
to `toolNames` there when its first screen ships, and nowhere else in code.

## Consequences

- One mark to clear, file, renew and defend, and one defensive domain set
  to renew each year.
- Each tool's name says what it does, and every tool is visibly part of
  the same suite.
- Applicants see Fairfold in the portal and in emails from the first live
  round, so the filing should be made well before then: UK registration
  takes at least four months after filing if nobody opposes it (GK).
- Tools can be added, renamed or retired without touching domains or
  filings.
- Nothing in code changes. The `toolNames` map in `brand.ts` grows as each
  tool's first screen ships.
- The roadmap's naming section and the docs use the product names above.

## Dependency check

No dependency is added.
