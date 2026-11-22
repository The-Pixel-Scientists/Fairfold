# Accessibility results

This page says what accessibility checking the software has had. It does not
claim that the software meets the Web Content Accessibility Guidelines (WCAG)
2.2 at level AA. No independent audit has been done yet.

Last checked against the code: 19 November 2026.

## What the automated checks cover

The project runs axe checks (an automated accessibility scanner) in its
end-to-end tests. Specs that carry the `@a11y` tag run with `pnpm test:a11y`.

| Area | Spec files with axe checks | Where |
| --- | --- | --- |
| Staff console | 27 | `apps/console/e2e/` |
| Applicant portal | 11 | `apps/portal/e2e/` |

They cover sign-in and account screens, programme set-up, the form builder,
submissions, assessment, decisions, the audit log, settings and the data
screens in the console, and the sign-in, application, files, profile,
messages and outcome journeys in the portal.

Browsers: the checks run in Chromium on every pull request, and the
`@a11y` specs also run on production builds in Firefox and WebKit. Playwright's
WebKit is not Safari. Specs tagged `@gallery` or `@api` run in Chromium only.

Axe finds only part of the problems. It cannot judge whether a label makes
sense, or whether a page works with a screen reader.

Run the checks yourself with `pnpm test:a11y` on the release you deploy. This
edition quotes no result counts, because no run is recorded for a tagged
release.

## Manual and screen-reader checks

Not yet available. The register plans checks with NVDA and Firefox on
Windows and with VoiceOver and Safari on macOS, starting with how the router
moves focus and announces a new page. No result is recorded.

## Known issues

The [register of known issues](../accessibility/known-issues.md) lists every
known problem and every check still to do. At this edition most rows read
"not yet checked". It is the full list, and this page does not copy it.

## External audit

An independent WCAG 2.2 AA audit is booked for January 2027. Its report is
not yet available. Until it is, treat any claim of conformance as unproven.

## Your accessibility statement

The [statement template](../accessibility/statement-template.md) says
"partially compliant". Do not change that to "fully compliant" unless an
audit supports it for your deployment. If you change the software or add your
own forms and content, you take on the testing of those.

## What you must do

- Test your own forms, documents and email templates.
- Publish your accessibility statement and keep it current.
- Tell people how to ask for a different format.
