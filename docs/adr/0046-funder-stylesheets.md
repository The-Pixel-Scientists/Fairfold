# ADR 0046: Funder stylesheets

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** Aaron Gardner

## Context

[ADR 0019](0019-tenant-addresses-public-pages-and-theming.md) gives a funder
a brand colour, one of three presets and a logo. The API builds `theme.css`
from those tokens, and "no free text reaches CSS".
[ADR 0045](0045-typeface-and-colour-schemes.md) added a dark scheme and
derives a dark brand colour from the light one.

On 5 October 2026 Aaron decided that, in MVP1, a funder can go further:

- download a commented stylesheet of every design token: light and dark
  colours, corner radii, type scale, density, and a font from an allowed
  list;
- edit it and upload it;
- have every value and every contrast pair checked, so WCAG 2.2 AA still
  holds.

The presets stay for funders who want something simpler. After MVP1, the
portal gains full custom CSS as an advanced option.

Constraints:

- WCAG 2.2 AA in both colour schemes, in both apps.
- The Content Security Policy in [ADR 0006](0006-design-system.md): styles
  come only from our own origin.
- The staff console is dense and keyboard-first, and a funder's look must not
  make it harder to work in.
- A funder's designer works in CSS, not in our data formats.
- Aaron reads every security-critical line, so the server should not parse
  arbitrary CSS in MVP1.

## Options considered

1. **Presets and a brand colour only**, as now. Simple, but too coarse for a
   funder with a style guide.
2. **A form field for every token on the Look page.** No files, but about 60
   fields make a poor screen, and designers cannot use their own tools.
3. **A commented token stylesheet to download, edit and upload.** The browser
   reads the file into tokens and shows any problem by line. The server
   checks the tokens and writes `theme.css` itself. Designers edit CSS they
   know, and a strict format leaves no way to inject a rule.
4. **A JSON token file.** Easy for programs, unfamiliar to funders, and no
   tool needs it yet.
5. **Full custom CSS.** The most freedom, but no way to guarantee contrast,
   focus or layout. It needs a sanitiser and a CSS parser, and CSS can hide
   or imitate the platform's own text.

## Decision

Option 3 for MVP1. Option 5 after MVP1, for the portal only, within the
limits below.

### The tokens

The custom property names in `packages/ui/src/tokens.css`, and no others:

| Group                   | Tokens                                                                                                                                                                                                               | Applies to |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Colours, light and dark | canvas, surface, sunken, ink, muted, edge, divider, accent, accent hover, accent soft, on accent, danger, danger hover, danger soft, on danger, success, success soft, warning, warning soft, info, info soft, focus | Both apps  |
| Radii                   | small, medium, large                                                                                                                                                                                                 | Both apps  |
| Font                    | One of: Atkinson Hyperlegible Next (the default), or the device's own system font                                                                                                                                    | Both apps  |
| Type scale              | Sizes and line heights from `xs` to `4xl`                                                                                                                                                                            | The portal |
| Density                 | Control height and padding, body size and line height, gutter, stack and field gap                                                                                                                                   | The portal |

The type scale and density apply only where the comfortable density does,
the portal. The console keeps its compact defaults.

### Values and checks

- Colours are `#rrggbb`. Lengths are `0` or a number of `rem` with up to
  three decimal places. The font is one name from the list.
- Contrast is checked for every pair in one list, in both schemes:
  - text at least 4.5:1 on each surface it appears on;
  - borders, the focus ring and filled controls at least 3:1.

  The list lives in the domain package. The design system's own token test
  uses the same list, so a funder's look meets the same bar as ours.

- Bounds keep the layout working and targets large enough:

  | Token                       | Bounds                                                                         |
  | --------------------------- | ------------------------------------------------------------------------------ |
  | Radii                       | 0 to 1.5rem, with small ≤ medium ≤ large                                       |
  | Type sizes                  | 0.75rem to 3rem, growing from `xs` to `4xl`; `base` at least 1rem              |
  | Line heights                | Between 1.1 and 2 times their size, and at least 1.4 times for `sm` and `base` |
  | Control height              | 2.5rem to 3.5rem, so targets stay well above 24 by 24 pixels                   |
  | Control padding             | 0.5rem to 1.5rem                                                               |
  | Body size                   | 1rem to 1.25rem, with line height at least 1.4 times                           |
  | Gutter, stack and field gap | 0.25rem to 3rem                                                                |

### Download and upload

- The console builds the stylesheet from the funder's current look (its
  preset and brand colour, or its saved tokens) and downloads it. It has
  three rule blocks: light, dark, and the portal's density. Every token
  carries a comment saying what it colours or sizes and the rule it must
  meet.
- On upload, the console reads the file, which may be at most 32 KB. It
  accepts only comments, the three blocks and declarations of known tokens,
  each once. It lists every problem with its line, and previews the look in
  both schemes.
- It sends the parsed tokens, never the file. The server checks them again
  with the same schema, bounds and pairs, and refuses anything that fails. It
  never parses CSS.
- Comments and formatting are not kept. The next download is written afresh
  from the saved tokens.

### Storage and serving

- `app.tenant_theme` gains a nullable `tokens` column. Null means the preset
  and brand colour are in use.
- Saving a preset or brand colour clears the tokens, after the console asks.
  So does "Go back to a preset".
- `app.public_tenant()` also returns the tokens. Its owner gains `SELECT` on
  the column, which amends ADR 0019's table. Its fallback brand colour
  becomes ink, `#1b1d21`, as ADR 0045 planned.
- `theme.css` is built from the stored tokens, checked again on every build.
  The server writes each value from its parsed form: colours as lower-case
  hex, lengths as numbers with `rem`, and the font as a fixed font stack for
  its name. Light values go under `:root`, dark ones under the dark-scheme
  selector, and the type scale and density under
  `[data-density='comfortable']`.
- This replaces ADR 0019's rule that no free text reaches CSS with a
  narrower one: only values the server writes from checked tokens reach CSS.
  No text a funder typed is ever copied into a stylesheet.
- Logos are unchanged.

### Permissions and history

- `platform.settings.manage`, as for the rest of the look.
- Each change writes a configuration version, with a diff by token name, and
  `platform.theme.changed` naming the changed tokens.

### After MVP1: the portal's own CSS

A later task builds this, with its own dependency check:

- **Where it applies:** the portal only, never the console, and never the
  sign-in, verification, account security or consent screens.
- **Sanitising:** on the server, with a maintained CSS parser. `@import`,
  `url()`, `@font-face`, `expression()`, `behavior`, `-moz-binding`, escapes
  that spell any of them, and anything the parser does not understand are
  removed.
- **Size:** at most 64 KB.
- **Serving:** a separate same-origin stylesheet, after `theme.css`. The
  Content Security Policy is unchanged, so nothing can load from another
  site.
- **Who owns accessibility:** the funder confirms that they then own the
  portal's accessibility. The Look page says so, and the confirmation is
  audited. Our automated checks cover only the default look.
- **Switching it off:** an operator setting turns the option off for a
  deployment.

## Consequences

- A funder with a style guide can match it without code. The presets stay
  the simple route.
- ADR 0019's theming section is amended in two places: server-written values
  replace "no free text", and the public tenant function returns the tokens.
  ADR 0045's derived dark colours still apply to presets; a stylesheet sets
  its dark values directly.
- `tokens.css` and the domain package's default tokens must stay the same.
  A test compares them.
- Renaming a token in `tokens.css` breaks saved stylesheets. The domain
  package then maps the old name, or a migration rewrites stored tokens.
- Adding a font means adding its file under the SIL Open Font License, its
  licence text and a `NOTICE` line.
- About 310 lines of security-critical review: the contracts, the migration
  and the API.

## Dependency check

No dependency is added for MVP1. The portal's own CSS will need a CSS parser.
css-tree 3.2.1 (MIT, released 5 March 2026) is the likely candidate, checked
under [ADR 0002](0002-licence-and-dependency-policy.md) when that work is
scheduled.
