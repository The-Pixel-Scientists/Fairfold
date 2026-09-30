# ADR 0014: Client-side routing for the console and portal

- **Status:** accepted
- **Date:** 2026-09-28
- **Deciders:** Aaron Gardner

## Context

The console and portal are single-page apps built with Vite
([ADR 0005](0005-dev-topology.md)). Both need deep links, such as the
application an email points to, working back and forward buttons, and pages
that load only when needed. The portal's first task (S01-06) already needs a
route change to move focus to the page's main heading and update the
document title.

Constraints:

- Accessibility ([ADR 0006](0006-design-system.md)): on every navigation,
  move focus to the new page's `h1`, set the document title, announce the new
  page to screen readers, and respect reduced motion when scrolling. No
  router below does this for us; we write it whichever we choose.
- Content Security Policy: `script-src 'self'` with no inline scripts.
- The portal serves small charities on old devices and slow connections, so
  bundle size counts.
- Dependencies are pinned, at least 7 days old, and updated in one batch a
  month ([ADR 0001](0001-monorepo-toolchain.md)).
- Links and redirects must never leave the app: a crafted path such as
  `//evil.example` or `/\evil.example` is an open redirect.

## Options considered

Sizes are from a minimal two-route app built with Vite 8.3.0 and React
19.3.0, minified and gzipped, over the 65.9 kB the same app needs with no
router.

1. **TanStack Router** (`@tanstack/react-router` 1.170.38, MIT).
   - Pros: fully typed routes and search parameters, validated with Zod,
     which fits our contracts ([ADR 0004](0004-api-contract.md)). Loaders,
     pending states, navigation blocking and scroll restoration with no
     inline script in a single-page app.
   - Cons: +25.0 kB. Very fast release cadence (24 releases in 90 days, 261
     commits), which fights the monthly batch. Its publishing was compromised
     on 12 May 2026: two releases of `@tanstack/react-router` and about forty
     other `@tanstack/*` packages shipped malware that stole credentials
     (GHSA-g7cv-rxg3-hmpx). The 7-day rule would have kept those versions
     out, but the incident counts against the project's release process.
2. **React Router** (`react-router` 8.4.0, MIT).
   - Pros: the most widely used React router (56k stars, maintained by the
     Remix team; 9 releases and 147 commits in 90 days). Data mode gives
     loaders, navigation blocking and scroll restoration; in a single-page
     app its `ScrollRestoration` renders no inline script.
   - Cons: +28.8 kB. Twenty advisories since April 2025, six of them in July
     2026. Most concern framework mode, server rendering or server
     components, which we would not use, but open redirects have reached the
     client navigation code we would use (GHSA-wrjc-x8rr-h8h6, a backslash
     in `<Link>` and `useNavigate`, fixed in 7.18.0; GHSA-2j2x-hqr9-3h42,
     paths starting `//`, fixed in 7.14.1).
3. **A small history router in `packages/ui`.**
   - Pros: +0.6 kB for a prototype with matching, parameters, links and the
     focus, title and announcement behaviour. No dependency, no advisories
     to track, and every line is ours to review and test, including the
     internal-path check. It lives beside the components that already carry
     our accessibility rules.
   - Cons: we own and test the code, about 300 lines. No loaders, typed
     routes or nested route framework: we compose layouts by hand, load data
     through the `call()` helper, and parse parameters and search strings
     with Zod schemas from `packages/domain`. If the apps outgrow it, moving
     to option 1 or 2 is a contained change behind the same exports.

## Decision

Option 3: a small history router in `packages/ui`, built and tested before
S01-06 needs it. It exports:

- `Router`, taking a route table (path pattern, page title, lazily loaded
  component) and an optional base path for single-host installs
  ([ADR 0010](0010-authentication-security-rules.md));
- `Link`, a real `<a href>`, so opening in a new tab and copying still work,
  which handles only plain left clicks itself;
- `useNavigate`, `useParams` and `useSearch` (the search string parsed
  through a Zod schema);
- `RouteAnnouncer`, a polite live region;
- `useLeaveGuard`, which asks before leaving a page with unsaved changes.

Rules the tests pin down:

- Navigation accepts only app paths: starting with a single `/`, with no
  backslash, scheme or host. Anything else throws, so a crafted value can
  never become a redirect.
- After each navigation the router sets the document title, scrolls to the
  top (instantly under `prefers-reduced-motion`), moves focus to the page's
  `h1`, which has `tabindex="-1"`, and announces the new title. The first
  page load keeps the browser's own focus.
- Unknown paths render a not-found page with the same behaviour.

No dependency is added. If Aaron prefers a library, option 1 is the stronger
fit for typed search parameters, and option 2 for maturity and familiarity.

## Consequences

- The console-builder writes the router in `packages/ui`, with the
  accessibility reviewer's sign-off, before the portal-builder's S01-06
  work on route changes.
- Component tests with Testing Library cover focus, title, announcements,
  modifier-key clicks and the internal-path rule; the portal and console
  e2e tests cover back and forward.
- We revisit this if the apps need loaders, nested routes or typed search
  state that the router makes awkward; that change gets its own ADR.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| @tanstack/react-router (not chosen) | 1.170.38 | MIT | 2026-09-16 | 1.170.40 is too new; provenance attested; malware in 1.169.5 and 1.169.8 (GHSA-g7cv-rxg3-hmpx) |
| react-router (not chosen) | 8.4.0 | MIT | 2026-09-15 | Provenance attested; peer React 19.2.7 or later; 20 advisories since April 2025 |
| @testing-library/react | 16.3.3 | MIT | 2026-08-27 | Component tests; provenance attested |
| @testing-library/dom | 10.4.2 | MIT | 2026-09-13 | Peer of the above; provenance attested |
| @testing-library/user-event | 14.6.7 | MIT | 2026-09-02 | Keyboard tests; provenance attested |
