# Fair-funding monitoring reports

A fair-funding monitoring report shows whether your funding reaches people
fairly: who applied, and how far and how well each group did. It is built
from equality monitoring answers that applicants chose to give. Because
these answers are among the most sensitive data you hold, the report shows
totals only, and hides any number small enough to point at a person.

## What a report shows

- **Totals, never single responses.** A report counts one monitoring
  question's answers. Nobody who uses Fairfold Reporting sees one person's
  answer, and reviewers and programme staff do not see whether anyone
  answered.
- **Only answers given with consent.** Applicants answer after they apply,
  they can skip it, and they can withdraw their answers. A withdrawn answer
  is not counted.
- **Only rounds that have closed for monitoring.** Figures do not move while
  applications and answers are still coming in.
- **One question, at most one breakdown and at most one filter.** The screen
  offers two breakdowns: **outcome** and **stage reached**. The filter is one
  programme, one round or one financial year. Questions are never set against
  each other.
- **Counts, not percentages.** "Prefer not to say" is counted like any other
  answer.

You need the **View equality monitoring totals, with small numbers hidden**
permission, which analysts have. Run a report from the equality monitoring
page. Every run is recorded in the [audit log](../../../docs/admin/audit-log.md)
with the report, its version and the rule applied. The record holds ids,
codes and the number of cells shown and hidden, and never a count of people
or an answer. The figures themselves are kept nowhere. Run the report again
to see them again.

## How small numbers are hidden

Three protections apply to every report. Each is on for everyone, and no
setting turns one off.

### Hiding small cells

A cell that counts fewer people than the **threshold** is hidden. The screen
reads **Fewer than 10** in its place, where 10 is the threshold in force. A
count of zero is shown. A cell is never shown as a bar, a range or a percentage
when it is hidden.

### Hiding more to protect the small cells

Hiding one cell is not enough if a total next to it gives the number away. So
the software also hides further cells and, where needed, totals, so that
hidden numbers cannot be found from what is shown. This is why a hidden cell
can hold more people than the threshold. Treat every hidden cell as hidden
and read nothing into it. On a breakdown by outcome, a cell holding all or
none of its group is hidden too, because it would tell someone who knows one
member's answer what that member's outcome was.

### Withholding a small group

If the whole group a table counts is smaller than the **minimum group**, the
report shows no table. It says: "Too few responses to show this report.
Choose a wider filter."

If you run a report that the software cannot show without risk of revealing a
small group, it refuses with: "This report can't be shown now, because it
could be set against earlier reports to reveal a small group. Choose a wider
filter." The refusal names no table or number, and it is recorded.

## A worked example

The numbers are invented. A funder runs a report on one question with no
breakdown, for a round that closed for monitoring. The threshold is 10.

| Answer | Responses |
| --- | --- |
| Option A | 46 |
| Option B | 31 |
| Option C | Fewer than 10 |
| Option D | Fewer than 10 |
| Prefer not to say | 24 |
| Total | 120 |

Two options are hidden. The report does not say which is the smaller. Report
the other rows as they are shown, and say that two options are not shown
because their groups are small.

Suppose the funder instead filters to a single small round with 14 responses
in all. The minimum group is 20, so the report shows only "Too few responses
to show this report. Choose a wider filter."

## When a report is withheld or refused

Choose a wider filter or fewer breakdowns, as the message says:

- filter to a programme or a financial year instead of one round;
- remove the breakdown.

Nothing you can change in a report will show a hidden number.

## The disclosure rule

The **disclosure rule** holds the threshold and the minimum group.

- The platform floor is a threshold of 10 and a minimum group of 20. A
  funder that has set nothing uses the floor.
- A funder can raise either number, never lower it. The minimum group cannot
  be smaller than the threshold. The limits are held in the code and by the
  database.
- Changing the rule needs the **Raise the thresholds that hide small numbers
  in reports** permission, which administrators have, and a fresh sign-in
  confirmation.
- Each change is a new version of the rule, recorded with the member who made
  it and what changed, and written to the audit log as
  "insight.disclosure_rule.changed".
- Every report shows the rule version it applied. While the funder uses the
  floor, there is no version.

## Using the figures well

- Do not try to work out a hidden cell from other reports, other filters,
  exports or your own knowledge of who applied. The protections assume
  nobody does, and the software records what has been shown.
- Do not publish figures for smaller groups than the report shows, or
  present a hidden cell as a number.
- Publish what the report shows, with the rule version.

## These figures stay in the console

Monitoring figures never enter the warehouse or the
[snapshot](loading-the-snapshot.md), and no dashboard shows them. Read them in
the console's report table, which is also the accessible form of the data.

The software provides the hiding and the audit record. You provide the legal
basis for asking the questions, the privacy notice and your decision to
publish. This guide is not legal advice.
