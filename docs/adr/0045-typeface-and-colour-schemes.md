# ADR 0045: Typeface and colour schemes

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** Aaron Gardner

## Context

[ADR 0006](0006-design-system.md) set up the tokens, said fonts are
self-hosted from `packages/ui`, and left the typeface open. The apps used
system fonts and had one colour scheme, light, with a blue accent.

Two things change that:

- **A house style.** Fairfold's mark is black and white, and its site is set
  in Atkinson Hyperlegible Next. The product should look like the same
  family: ink on paper, with colour kept for meaning.
- **A dark scheme.** Many people work with their device in dark mode, some
  because bright screens hurt. The apps should follow the device, and let a
  person choose.

Constraints:

- **The policy.** The Content Security Policy in ADR 0006 allows no inline
  script.
- **Funder themes.** A funder's theme ([ADR 0019](0019-tenant-addresses-public-pages-and-theming.md))
  overrides the accent and surfaces. It must work in both schemes and keep
  WCAG 2.2 AA.
- **Licences.** [ADR 0002](0002-licence-and-dependency-policy.md)'s licence
  list covers code dependencies and has no rule for font files.

## Options considered

1. **Typeface: system fonts.**
   - Pros: nothing to load or license.
   - Cons: the text looks different on every device, and nothing ties the
     product to the brand.
2. **Typeface: Atkinson Hyperlegible Next, self-hosted.**
   - Pros: designed by the Braille Institute for legibility, with letters
     that are hard to confuse (I, l and 1; O and 0). One variable file
     covers every weight, 34 KB for Latin. It matches the site.
   - Cons: a font file under the SIL Open Font License 1.1, which the
     licence list does not name. It has no italics, so the browser slants
     the upright.
3. **Schemes: `prefers-color-scheme` in CSS only.**
   - Pros: no script.
   - Cons: no way to choose a scheme other than the device's.
4. **Schemes: a `data-scheme` attribute set before the first paint by a small
   same-origin script, with dark tokens under that selector.**
   - Pros: follows the device, and allows a choice, with no flash of the
     wrong scheme and no inline script.
   - Cons: one more blocking request, a few hundred bytes, on first load.

## Decision

Options 2 and 4.

- **Typeface.**
  - Atkinson Hyperlegible Next, served from `packages/ui` with its licence
    beside it (`fonts/OFL.txt`) and credited in `NOTICE`. Other letters fall
    back to the system font.
  - The file is version 2.001 from the
    [project](https://github.com/googlefonts/atkinson-hyperlegible-next),
    cut to the Latin range Google Fonts serves (the `unicode-range` in
    `styles.css`). Its SHA-256 is
    `18b2a1a39a2fa298b0ba5390aca68462669826c90925656f1c1f6796e0e1bbaf`.
  - Font files under OFL-1.1 are allowed, with the licence text, and each
    is recorded with its version and SHA-256. A subset or other modified
    file is allowed only when the licence declares no Reserved Font Name,
    as this one does not. This adds to ADR 0002 for font files only; code
    dependencies still follow its list.
- **Palette.** Ink on paper:
  - warm off-white surfaces and near-black ink;
  - the accent is ink unless a funder sets a brand colour;
  - colour is kept for status, focus and the funder's brand.
- **Schemes.**
  - `public/scheme.js`, in the head of each app's `index.html`, sets
    `data-scheme` to `light` or `dark` on the page element before the first
    paint: the stored choice if there is one, otherwise the device's.
  - The choice is kept in `localStorage` under `colour-scheme`, shared by
    the apps on one address. It is a preference on the device, not personal
    data, and is not sent to the server.
  - `tokens.css` gives every colour a dark value under
    `:root[data-scheme='dark']`, and a test checks every contrast pair in
    both schemes.
  - An Appearance switch (Device, Light, Dark) sits in every page's footer.
- **Funder themes in the dark.**
  - `theme.css` gains a second block for the dark scheme.
  - A brand colour with no hue (ink, black, greys) becomes the scheme's own
    paper white.
  - Any other colour keeps its hue at a fixed lightness in the OKLab colour
    space, with a dark tint of it behind the current page.
  - Every brand colour that passes the light check gets dark shades that
    pass too, and a test sweeps the colour space to prove it.
  - Logos sit on a light chip in the dark, since most are drawn for a light
    background.
- **Default brand colour.** The default brand colour becomes ink, `#1b1d21`.
  A colour that dark gets a lighter hover shade, as a darker one would not
  show.

## Consequences

- Every screen must be checked in light and dark. The axe checks run in
  both.
- Components use tokens only, never raw colours. Anything that must differ
  in the dark uses the `dark:` variant.
- `app.public_tenant()` must fall back to the same default. The pull
  request that brings in this design moves it: migration 0007 changes the
  fallback for a funder with no saved theme from the old blue, `#1f4bb8`,
  to `#1b1d21`, in the same commit as the new default.
- Welsh and other letters outside Latin-1 fall back to the system font until
  the Latin Extended file is added.
- A funder's own stylesheet, planned in ADR 0046, builds on these tokens.
