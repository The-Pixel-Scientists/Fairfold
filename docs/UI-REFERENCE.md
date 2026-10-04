# UI reference

**Reference repository:** [zite/grant-management](https://github.com/zite/grant-management)
**Licence:** MIT. We study its patterns; we do not copy its code. If we ever
adopt code from it, that decision is recorded in an ADR and the code is
credited in `NOTICE` with its licence.

The reference is a React, Vite and Tailwind grants app with a staff console
(`apps/grant-management`) and an applicant portal (`apps/applicant-portal`).
It is new (one maintainer, no production history), so treat it as a source of
interaction ideas, not as proof that a pattern works at scale.

## What to take from it

- **Navigation that keeps context visible.** A persistent sidebar and page
  header show which programme you are in, with a command palette for jumping
  anywhere (`components/shell/AppShell.tsx`, `Sidebar.tsx`, `PageHeader.tsx`,
  `CommandPalette.tsx`).
- **Keyboard-first working.** Discoverable shortcuts with a shortcuts dialog
  (`lib/hotkeys.ts`, `components/shell/ShortcutsDialog.tsx`).
- **Dense, fast tables.** Filters, saved views, display options, bulk
  selection with an action bar, and a board view (`components/submissions/`).
- **Split-pane detail and scoring.** The application on one side and the
  scorecard on the other, with autosave and a save indicator
  (`components/review/ReviewWorkspace.tsx`, `ApplicationPane.tsx`,
  `ScorecardPane.tsx`).
- **Recusal as a first-class action** before scoring (`components/review/RecuseDialog.tsx`).
- **Private decisions released separately** (`components/dialogs/DecisionDialog.tsx`).
- **A form builder with outline, canvas and live preview**, plus a guard
  against leaving with unsaved changes (`components/builder/`).
- **Applicant autosave that says so** (`applicant-portal/src/lib/useAutosave.ts`,
  `components/SaveIndicator.tsx`), a stepper for long forms (`pages/DraftStepper.tsx`)
  and a review page before submitting (`pages/ReviewSubmitPage.tsx`).
- **Focus management and document titles on route change**
  (`applicant-portal/src/lib/focus.ts`, `lib/useDocumentTitle.ts`).

## Screens to study

| Reference screen or file | Our equivalent | Notes |
| --- | --- | --- |
| `grant-management/src/pages/SubmissionsPage.tsx`, `components/submissions/SubmissionsView.tsx`, `SubmissionTable.tsx`, `BulkActionBar.tsx`, `SaveViewDialog.tsx`, `filters.tsx` | Submissions list (console) | Filters for programme, round, stage, status, owner, score and late. Saved views. Bulk move stage, assign owner and add label. |
| `grant-management/src/pages/SubmissionPage.tsx`, `components/dialogs/AssignReviewersDialog.tsx`, `DecisionDialog.tsx` | Submission detail (console) | Answers, attachments, history, notes with mentions, messages. Decision is recorded privately; release is a separate action. |
| `grant-management/src/pages/ReviewPage.tsx`, `components/review/ReviewWorkspace.tsx`, `ScorecardPane.tsx`, `scorecardFocus.ts` | Reviewer scoring (console) | Application beside the rubric, autosave, keyboard navigation between criteria. Blind review hides identity fields on the server, never only in the client. |
| `grant-management/src/pages/ProgramPage.tsx`, `components/program/settings/PipelineSettings.tsx`, `ReviewSettings.tsx`, `EmailSettings.tsx` | Programme set-up (console) | Rounds with open and close dates in a stated timezone, stages with a rubric each, email templates. Every change creates a config version. |
| `applicant-portal/src/pages/ApplyPage.tsx`, `DraftStepper.tsx`, `ReviewSubmitPage.tsx`, `lib/useAutosave.ts` | Application form (portal) | One task per screen, clear progress, autosave with a visible status, review page listing missing items before submit. |

## What not to copy

- Anything that conflicts with WCAG 2.2 AA, the [content style guide](CONTENT-STYLE.md),
  or the calm, spacious applicant portal principle.
- AI features (summaries, synthesis, generated forms). V1 has no AI features.
- Its data model shortcuts: text-typed foreign keys, three fixed roles, and no
  field classification or retention.
- Client-side hiding of sensitive fields. Our API never sends what a user may
  not see.

## Design tokens

These are the tokens the console and the portal share
([ADR 0006](adr/0006-design-system.md)). They live in one file,
`packages/ui/src/tokens.css`, and every component reads them from there. This
section lists the values that file holds today. If the two disagree, the file
is right: fix this page in the same change.

Tailwind only generates classes for the names below. The file clears
Tailwind's own colours, fonts, type sizes, radii, shadows and easing, so
`bg-blue-500` does not exist.

### Colour

Colours are six-digit hex values.

| Token | Value | Used for |
| --- | --- | --- |
| `canvas` | `#f5f6f8` | Page background |
| `surface` | `#ffffff` | Cards, panels, inputs |
| `sunken` | `#eceef2` | Recessed areas, hover on secondary buttons |
| `ink` | `#161a20` | Body text and headings |
| `muted` | `#4b5360` | Secondary text, hints |
| `edge` | `#78808c` | Outlines of inputs and secondary buttons |
| `divider` | `#d9dde3` | Decorative rules between sections |
| `accent` | `#1f4bb8` | Links, primary actions, the current page |
| `accent-hover` | `#193d99` | Primary button and link on hover |
| `accent-soft` | `#e4ebfb` | Tint behind the current page and quiet-button hover |
| `on-accent` | `#ffffff` | Text on `accent` and `accent-hover` |
| `danger` | `#b3261e` | Errors and actions that cannot be undone |
| `danger-hover` | `#8f1d17` | Danger button on hover |
| `danger-soft` | `#fcebea` | Tint behind an error message |
| `on-danger` | `#ffffff` | Text on `danger` and `danger-hover` |
| `success` | `#17653a` | Success text and icons |
| `success-soft` | `#e3f4ea` | Tint behind a success message |
| `warning` | `#7a4a00` | Warning text and icons |
| `warning-soft` | `#fdf1d8` | Tint behind a warning message |
| `focus` | `#1a2f8a` | The focus ring |

### Contrast ratios

`packages/ui/src/tokens.test.ts` measures every pair below with the WCAG 2.2
formula and fails if one drops under its limit. Text needs 4.5:1
(success criterion 1.4.3). Borders, the focus ring and filled controls need
3:1 (1.4.11). The ratios here are what the pairs measure today, rounded down
to one decimal place.

Text on its backgrounds. Limit: 4.5:1.

| Text colour | Value | Tested against, with ratio |
| --- | --- | --- |
| `ink` | `#161a20` | `canvas` 16.1, `surface` 17.4, `sunken` 15.0, `accent-soft` 14.6, `danger-soft` 15.1, `success-soft` 15.2, `warning-soft` 15.5 |
| `muted` | `#4b5360` | `canvas` 7.1, `surface` 7.7, `sunken` 6.6, `accent-soft` 6.4 |
| `accent` | `#1f4bb8` | `canvas` 7.0, `surface` 7.6, `sunken` 6.5, `accent-soft` 6.3 |
| `danger` | `#b3261e` | `canvas` 6.0, `surface` 6.5, `sunken` 5.6, `danger-soft` 5.6 |
| `success` | `#17653a` | `surface` 7.0, `success-soft` 6.2 |
| `warning` | `#7a4a00` | `surface` 7.4, `warning-soft` 6.6 |
| `on-accent` | `#ffffff` | `accent` 7.6, `accent-hover` 9.6 |
| `on-danger` | `#ffffff` | `danger` 6.5, `danger-hover` 8.9 |

Outlines, the focus ring and filled controls against what surrounds them.
Limit: 3:1.

| Colour | Value | Tested against, with ratio |
| --- | --- | --- |
| `edge` | `#78808c` | `canvas` 3.6, `surface` 3.9, `sunken` 3.4 |
| `accent` | `#1f4bb8` | `canvas` 7.0, `surface` 7.6, `sunken` 6.5 |
| `danger` | `#b3261e` | `canvas` 6.0, `surface` 6.5, `sunken` 5.6 |
| `focus` | `#1a2f8a` | `canvas` 10.6, `surface` 11.5, `sunken` 9.9, `accent-soft` 9.6, `danger-soft` 10.0, `success-soft` 10.1, `warning-soft` 10.3 |

Rules that follow from the tables:

- A pair that is not listed has not been tested. Do not put `muted` text on a
  `danger-soft` background, or `success` text on `canvas`, until the pair is
  added to the test.
- `divider` is decoration, so it has no limit. Never use it to mark the edge
  of a control; use `edge`.
- `accent-hover` also colours link text on hover. The test checks it only as
  a background under white text, so that use is not covered.
- A new colour token fails the test until it appears in a pair. A colour that
  is only decoration must be named in the test's `decorative` list.

### A tenant's brand colour

A funder will be able to replace the accent with its own brand colour. The
rules are in code in `packages/domain/src/platform/theme.ts`; the apps do not
apply a tenant theme yet.

- The colour is a hex code such as `#1f4bb8`. The default is the `accent`
  value above.
- The hover shade is the colour 20% of the way to black. The tint is the
  colour 90% of the way to white.
- The colour is refused unless it reaches 4.5:1 as text on `surface`,
  `canvas`, `sunken` and its own tint, its hover shade reaches 4.5:1 on
  white, and `ink` reaches 4.5:1 on its tint. The error offers the nearest
  darker colour that passes.
- A theme also names a preset (`standard`, `rounded` or `square`) and may
  name a PNG or WebP logo.

### Type

There are no font files yet. Both families are system fonts, so nothing loads
from a font host (ADR 0006). Self-hosted fonts will replace them once chosen.

| Token | Value |
| --- | --- |
| `font-sans` | `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| `font-mono` | `ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace` |

| Size token | Font size | Line height |
| --- | --- | --- |
| `text-xs` | `0.75rem` (12px) | `1rem` (16px) |
| `text-sm` | `0.875rem` (14px) | `1.25rem` (20px) |
| `text-base` | `1rem` (16px) | `1.5rem` (24px) |
| `text-lg` | `1.125rem` (18px) | `1.75rem` (28px) |
| `text-xl` | `1.25rem` (20px) | `1.75rem` (28px) |
| `text-2xl` | `1.5rem` (24px) | `2rem` (32px) |
| `text-3xl` | `1.875rem` (30px) | `2.25rem` (36px) |

`text-body` is the size of running text. It follows the density (below):
16px on 24px in comfortable, 14px on 20px in compact. Components use the
weights `font-normal`, `font-medium` and `font-semibold`; these are
Tailwind's own and are not set in the tokens file.

### Spacing and density

Spacing is a multiple of `0.25rem` (4px): `p-4` is 16px. `--spacing-target`
is `24px`, the smallest size WCAG 2.2 allows for a pointer target (2.5.8).

Two sets of values share one set of components. Set `data-density` on any
element to switch inside it. `AppShell` sets `compact` unless told otherwise,
so the console is compact; the portal asks for `comfortable`. Outside an
`AppShell`, the default is comfortable.

| Token | Class that reads it | Comfortable | Compact |
| --- | --- | --- | --- |
| `--density-control-height` | `min-h-control` | `2.75rem` (44px) | `2rem` (32px) |
| `--density-control-px` | `px-control-x` | `0.875rem` (14px) | `0.625rem` (10px) |
| `--density-body-size` | `text-body` | `1rem` (16px) | `0.875rem` (14px) |
| `--density-body-leading` | `text-body` | `1.5rem` (24px) | `1.25rem` (20px) |
| `--density-gutter` | `p-gutter`, `gap-gutter` | `1.5rem` (24px) | `1rem` (16px) |
| `--density-stack` | `gap-stack` | `1.5rem` (24px) | `1rem` (16px) |
| `--density-field-gap` | `gap-field-gap` | `0.375rem` (6px) | `0.25rem` (4px) |

The test checks that both control heights are at least 24px.

`--sidebar-width` is `14rem` (224px).

### Radii

| Token | Value |
| --- | --- |
| `rounded-sm` | `0.25rem` (4px) |
| `rounded-md` | `0.375rem` (6px) |
| `rounded-lg` | `0.5rem` (8px) |
| `rounded-full` | `9999px` |

### Elevation

| Token | Value | Used today for |
| --- | --- | --- |
| `shadow-raised` | `0 1px 2px rgb(22 26 32 / 0.08), 0 1px 3px rgb(22 26 32 / 0.06)` | The page-loading notice |
| `shadow-overlay` | `0 8px 24px rgb(22 26 32 / 0.16), 0 2px 6px rgb(22 26 32 / 0.08)` | The skip link while it has focus |

### Motion and focus

| Token | Value |
| --- | --- |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--motion-fast` | `100ms` |
| `--motion-normal` | `180ms` |
| `--focus-ring-width` | `3px` |
| `--focus-ring-offset` | `2px` |

Under `prefers-reduced-motion: reduce`, both motion durations become `0ms`,
and `styles.css` cuts every animation and transition to `0.01ms` and turns
off smooth scrolling. The test checks that the ring is at least 2px thick.

Links, buttons, inputs, selects, text areas, `summary` elements and anything
with a `tabindex` get one ring, in the `focus` colour, when they take focus
from the keyboard.
