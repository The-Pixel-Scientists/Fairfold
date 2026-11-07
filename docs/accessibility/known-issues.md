# Known accessibility issues

This register lists every known accessibility problem and every check still to
do. The [accessibility statement](statement-template.md) links here and does
not copy the list.

## How to use this register

Whoever finds a problem adds a row, at merge or after an audit. Give it the
next free id (`A11Y-nnn`). Ids are never reused. When a problem is fixed, change
its status to "fixed" and its date. Do not delete the row. Keep one row per
issue and no paragraphs. Put long findings from an audit in the auditor's
report, and link the finding number in the row.

Columns:

- **Status** is one of: open, fixed, not yet checked, disproportionate burden,
  out of scope.
- **Found by** is one of: axe, manual check, audit, user report, review of the
  code.
- **Task** is the task that fixes or checks the row.

Last updated: 27 October 2026.

## What the evidence covers

- Axe finds only part of WCAG. It cannot judge, for example, whether a label
  makes sense or whether a page works with a screen reader.
- The axe checks cover the pages the specs visit, listed in the
  `apps/console/e2e` and `apps/portal/e2e` folders (specs tagged `@a11y`).
  They do not cover a page nobody wrote a check for.
- The checks run on the production builds in Chromium, Firefox and WebKit.

## Platform <a id="platform"></a>

The sign-in and account screens, the console and portal shells, the router and
the shared components.

| Id | Area | Journey or screen | WCAG 2.2 criterion | Level | Browsers and assistive technology | Found by | Status | Task | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-001 | Platform | Console pages in the axe specs | Any (automated rules) | A and AA | Chromium | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-002 | Platform | Console pages in the axe specs | Any (automated rules) | A and AA | Firefox | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-003 | Platform | Console pages in the axe specs | Any (automated rules) | A and AA | WebKit | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-004 | Platform | Portal pages in the axe specs | Any (automated rules) | A and AA | Chromium | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-005 | Platform | Portal pages in the axe specs | Any (automated rules) | A and AA | Firefox | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-006 | Platform | Portal pages in the axe specs | Any (automated rules) | A and AA | WebKit | axe | Not yet checked: no result recorded for this register | S11-16 | 27 October 2026 |
| A11Y-007 | Platform | All pages | Any | A and AA | Development builds | axe | Not yet checked: the Firefox and WebKit runs use production builds only | To be scheduled | 27 October 2026 |
| A11Y-008 | Platform | Component gallery and API-backed specs | Any | A and AA | Firefox, WebKit | axe | Not yet checked: specs tagged `@gallery` or `@api` run in Chromium only | To be scheduled | 27 October 2026 |
| A11Y-009 | Platform | All pages | Any | A and AA | Safari on macOS and iOS | manual check | Not yet checked: Playwright's WebKit is not real Safari | January audit | 27 October 2026 |
| A11Y-010 | Platform | All pages | Any | A and AA | Mobile browsers | manual check | Not yet checked | January audit | 27 October 2026 |

### Router: moving between pages

The router moves focus to the page's main heading and announces "Navigated to"
and the page title in a polite live region. The check below uses NVDA with
Firefox on Windows, and VoiceOver with Safari on macOS. The results are not yet
recorded, so every row is "not yet checked". The automated route-announcement
spec covers the same cases in Chromium, Firefox and WebKit.

| Id | Area | Journey or screen | WCAG 2.2 criterion | Level | Browsers and assistive technology | Found by | Status | Task | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-011 | Platform | Follow a link to a new page | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-012 | Platform | Open an address that does not exist | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-013 | Platform | Back and forward | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-014 | Platform | A page slow to load | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-015 | Platform | A page that fails to load | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-016 | Platform | Change only the search string | 4.1.3 Status messages | AA | NVDA with Firefox | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-017 | Platform | Follow a link to a new page | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-018 | Platform | Open an address that does not exist | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-019 | Platform | Back and forward | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-020 | Platform | A page slow to load | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-021 | Platform | A page that fails to load | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-022 | Platform | Change only the search string | 4.1.3 Status messages | AA | VoiceOver with Safari | manual check | Not yet checked | S11-07 | 27 October 2026 |
| A11Y-023 | Platform | Any page change | 4.1.3 Status messages | AA | Screen readers | review of the code | Not yet checked: a screen reader may read the heading and the announcement, so a page may be heard twice | S11-07 | 27 October 2026 |

### Other assistive technology and browsers

| Id | Area | Journey or screen | WCAG 2.2 criterion | Level | Browsers and assistive technology | Found by | Status | Task | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-024 | Platform | Portal: sign up, profile, apply, submit, see outcome | Any | A and AA | iOS Safari 16.4 (the oldest we support) and the oldest iOS version available to the tester | manual check | Not yet checked: required before Gate 1 (ADR 0006) | To be scheduled | 27 October 2026 |
| A11Y-025 | Platform | Key journeys | Any | A and AA | JAWS | audit | Not yet checked | January audit | 27 October 2026 |
| A11Y-026 | Platform | Key journeys | Any | A and AA | Narrator | audit | Not yet checked | January audit | 27 October 2026 |
| A11Y-027 | Platform | Key journeys | Any | A and AA | TalkBack | audit | Not yet checked | January audit | 27 October 2026 |
| A11Y-028 | Platform | Key journeys | Any | A and AA | Dragon | audit | Not yet checked | January audit | 27 October 2026 |
| A11Y-029 | Platform | Dialogs and notices | 1.4.11 Non-text contrast | AA | Windows forced colours mode | review of the code | Not yet checked: the code styles forced colours only for the colour scheme switch | January audit | 27 October 2026 |

### Known patterns

| Id | Area | Journey or screen | WCAG 2.2 criterion | Level | Browsers and assistive technology | Found by | Status | Task | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-030 | Platform | Close a tab or reload a page with unsaved changes | None identified | n/a | All browsers | review of the code | Open: the browser shows its own warning, which a page cannot reword. Moving inside the service uses a designed dialog. | None | 27 October 2026 |

## Fairfold Grants <a id="grants"></a>

No grants-specific rows yet. The grants screens are covered by the axe specs
under the platform rows above, and by the January audit.

## Contacts and organisations <a id="crm"></a>

No screens yet; checked when their screens merge (S12 screens) and in the
January audit.

## Assurance <a id="assure"></a>

No screens yet; checked when their screens merge (S12 screens) and in the
January audit.

## Forms <a id="forms"></a>

No screens yet; checked when their screens merge (S12 screens) and in the
January audit.

## Privacy <a id="privacy"></a>

No screens yet; checked when their screens merge (S12 screens) and in the
January audit.

## Insight <a id="insight"></a>

No screens yet; checked when their screens merge (S12 screens) and in the
January audit.
