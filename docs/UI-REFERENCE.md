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

To be agreed in sprint 1 and recorded here: colour palette (with contrast
ratios), type families and scale, spacing scale, radii, elevation, motion.
