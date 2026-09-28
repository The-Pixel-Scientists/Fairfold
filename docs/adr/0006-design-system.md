# ADR 0006: Design system

- **Status:** proposed
- **Date:** 2026-09-27
- **Deciders:** Aaron Gardner

## Context

Epic E11 needs a shared component library in `packages/ui` that meets WCAG 2.2
AA, with axe checks in CI and documented keyboard patterns. Two apps use it
with different characters: a dense, keyboard-first staff console and a calm,
spacious applicant portal. The baseline names React, Vite, Tailwind and a
Radix-based library.

The [UI reference](../UI-REFERENCE.md), zite/grant-management, is MIT
licensed. We study its patterns and do not copy its code.

Applicants include small charities on old devices and slow connections, so
browser support and bundle size matter more in the portal than in the
console.

## Options considered

1. **Radix Primitives with Tailwind.**
   - Pros: unstyled, accessible behaviour for dialogs, menus, popovers, tabs,
     tooltips and selects, with focus management done. Widely used and well
     understood. Matches the plan.
   - Cons: no combobox, date picker or data grid. Releases have slowed (last
     on 24 July 2026, 356 open issues), though commits continue.
2. **React Aria Components with Tailwind.**
   - Pros: Adobe's library has the most thorough accessibility and
     internationalisation work, and includes combobox, date picker and table
     with keyboard navigation.
   - Cons: a larger API and bundle, and its own styling conventions to learn.
3. **Base UI with Tailwind.**
   - Pros: from the creators of Radix, Floating UI and Material UI. Very
     active (429 commits in the last 90 days) and includes a combobox.
   - Cons: 1.0 only since December 2025, so a shorter track record.
4. **shadcn/ui.**
   - Pros: fast start; copies styled components built on Radix or Base UI into
     the repository.
   - Cons: we would own copied code with MIT notice duties, and its defaults
     are not tuned to WCAG 2.2 AA or our content style. We would rewrite most
     of it.

## Decision

Option 1: Radix Primitives (the `radix-ui` package) and Tailwind 4.

- `packages/ui` wraps every primitive. Apps import from `packages/ui`, never
  from Radix, so any one component can change library later without touching
  the apps. A Semgrep rule enforces this
  ([ADR 0002](0002-licence-and-dependency-policy.md)).
- Where Radix has no primitive, prefer native HTML: a three-field date input
  and native selects in the portal, a plain table with roving focus in the
  console. If a widget needs more than that (for example a combobox), a
  short follow-up ADR proposes React Aria for that widget rather than writing
  complex ARIA by hand.
- Tokens live in CSS with Tailwind's `@theme`: colour with recorded contrast
  ratios, type scale, spacing, radii, elevation and motion. Two density sets,
  compact for the console and comfortable for the portal, share one component
  set. Tokens are recorded in the UI reference in sprint 1.
- Built in from the start: visible focus with at least 3:1 contrast, focus
  never covered by sticky headers (2.4.11), targets at least 24 by 24 pixels
  (2.5.8), motion off under `prefers-reduced-motion`, layouts that work at
  320px and at 200% zoom.
- Tailwind 4 targets Safari 16.4, Chrome 111 and Firefox 128 or later, with
  fallbacks for older browsers since 4.1. The console supports those
  browsers. The portal's key journey must stay usable, if plainer, on an older
  iOS Safari, and we test that before Gate 1.

Content Security Policy, for both apps:

- `script-src 'self'` with no inline scripts and no `eval`; `style-src 'self'`
  plus a per-response nonce; `default-src 'self'`, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'` and `form-action 'self'`.
  `connect-src` adds only the storage origin that uploads go to
  ([ADR 0005](0005-dev-topology.md)).
- Styles come from our own stylesheet. A `<style>` element that a library
  injects must carry the nonce: Radix's scroll lock injects one through
  react-style-singleton, which reads it with get-nonce. The console and portal
  containers therefore serve `index.html` with a fresh nonce on each response,
  not as a plain static file.
- No third-party CDNs or font hosts. Fonts are self-hosted from `packages/ui`.
- The axe test pages run under the production policy, and a policy violation
  fails the test.

Other response headers, sent by both apps and the API, each checked by a
test:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains` on every
  HTTPS response. Preloading is left to the operator.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: same-origin`. Not `no-referrer`, under which browsers
  send `Origin: null` on form posts, even same-origin ones, and the `Origin`
  check on state-changing requests
  ([ADR 0010](0010-authentication-security-rules.md)) would refuse them.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(),
  usb=(), serial=(), hid=()`. Passkeys keep their default of `self`.
- `Cross-Origin-Opener-Policy: same-origin`.
- `Cache-Control: no-store` on every API response, auth routes included, and
  on each app's `index.html`, which carries a fresh nonce.

Testing:

- `pnpm test:a11y` runs @axe-core/playwright on key pages in real browsers.
  jsdom cannot check colour contrast, so component tests do not replace it.
- Static lint uses the jsx-a11y fork named in
  [ADR 0001](0001-monorepo-toolchain.md).
- Keyboard and screen reader checks (NVDA and VoiceOver) stay manual, per the
  definition of done.

Reference code: if we ever adopt code from zite/grant-management or
shadcn/ui, a new ADR records it and [NOTICE](../../NOTICE) credits the source,
copyright holder and licence.

## Consequences

- Building our own wrappers takes longer than copying styled components. In
  return we control every focus, label and error message.
- Changes to `packages/ui` need an accessibility review before merge.
- Mixing primitive libraries later is possible but costs bundle size. Each
  addition needs a reason, and a check that it works under the policy above.
- Design tokens are a sprint 1 deliverable, recorded in the UI reference.

## Dependency check

| Package | Version | Licence | Released | Notes |
| --- | --- | --- | --- | --- |
| radix-ui | 1.6.7 | MIT | 2026-07-24 | 114 commits in last 90 days; 356 open issues |
| tailwindcss | 4.3.3 | MIT | 2026-07-16 | Active; 3.4.19 on `v3-lts` |
| @tailwindcss/vite | 4.3.3 | MIT | 2026-07-16 | Same repository |
| @axe-core/playwright | 4.13.0 | MPL-2.0 | 2026-08-11 | Allowed under ADR 0002 |
| axe-core | 4.13.0 | MPL-2.0 | 2026-08-05 | Active |
| react | 19.3.0 | MIT | 2026-09-09 | Active |
| react-aria-components (not chosen) | 1.21.1 | Apache-2.0 | 2026-09-04 | Active; 190 commits in last 90 days |
| @base-ui/react (not chosen) | 1.8.0 | MIT | 2026-09-04 | Very active; 1.0.0 on 2025-12-11 |
| shadcn (not chosen) | 4.21.0 | MIT | 2026-09-04 | CLI that copies component code |
| zite/grant-management (reference only) | n/a | MIT | n/a | Last push 2026-09-22; 0 stars |
