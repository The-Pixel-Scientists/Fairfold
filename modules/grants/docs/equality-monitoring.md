# Equality monitoring

Equality monitoring helps you see whether your funding reaches people fairly.
After an applicant submits, Fairfold Grants can invite them to answer a few
optional questions, such as their age or ethnic group. You read the results
only as totals. You never see one person's answers.

The answers are special category data under UK GDPR Article 9. You need a lawful
basis and a privacy notice that covers them. Fairfold Grants is built on
explicit consent: each applicant agrees separately, and can skip or withdraw at
no cost. Ask your own adviser whether that suits your funder. This guide does
not give legal advice.

## What is available now

Withdrawing answers works in this release. Choosing a form for a round, and an
applicant saving answers, are completed in a later release. The screens exist,
but the server does not yet store which form a round uses. Until then, a round
shows no equality monitoring questions to applicants. Totals are read in the
insight tool, and its report screens are not part of this release.

## Set up a form

You need the permission to manage programmes (`grants.programmes.manage`).

1. Open the round's form page and choose **Create equality monitoring draft**.
   The draft starts from the **Equality monitoring** template, which holds every
   question in the platform's set: age, disability, ethnic group, religion or
   belief, sex, gender identity and sexual orientation.
2. Under **Questions to ask**, tick the questions you want and use **Move up**
   and **Move down** to order them.
3. Fix anything the form lists, then publish the draft.

You cannot add a question or change its wording or choices. Each question
asks only about the person answering. If you need another question, ask the
project to add it to the set.

Every question is seen **Only in totals**. That means staff and reviewers never
see the answer, and it counts only in reports. Every question is optional and
has a "Prefer not to say" choice. There are no free-text questions and no file
questions.

Before you can publish or use a form, it is checked. It is refused if a
question:

- is a file question, or marks the applicant as identified by it
- is not set to **Only in totals**, or is not marked as special category data
- is required
- has no "Prefer not to say" option
- is not one of the platform's questions, with its wording and options unchanged

The message names the question and says how to fix it.

## Choose the form for a round

The equality monitoring form is separate from the application form.

1. Open the round and choose the **Equality monitoring** tab.
2. Choose a version from **Equality monitoring form**. Only published versions
   that pass the checks are offered. Choose **No equality monitoring form** to
   turn it off.
3. Choose **Save equality monitoring form**.

This screen never shows answers, and never shows whether anyone has answered.

## What applicants see

After an application is submitted, the applicant sees an **Equality monitoring**
section with **Answer monitoring questions**. It explains, in plain words:

- they do not have to answer, and every question has "Prefer not to say"
- the answers are used only to count totals, and staff and reviewers never see
  them next to the application
- the answers have no effect on the application or on whether they get a grant
- nothing is saved until they send the answers

They tick a separate box to agree, then choose **Send my answers**. They can
choose **Skip these questions** instead. Skipping changes nothing.

Afterwards they can read their answers, and choose **Withdraw my answers**.
Withdrawing deletes the answers. The application does not change. Totals that
you have already read stay as they were, because they hold no personal data.

An applicant can answer until the round closes for monitoring. That is the
later of the round's closing time and the application's own extension. They can
withdraw at any time.

If staff submitted for the applicant, the applicant still answers these
questions themselves. Staff cannot fill them in.

## What staff never see

Nobody who assesses, decides or manages applications can see an individual
answer, or whether an applicant answered. That holds on every screen, export,
360Giving file, search, notification and warehouse snapshot. Monitoring answers
never enter the warehouse. Monitoring is never used to decide anything.

Two narrow exceptions exist, for the **Data protection lead** role
(`grants.monitoring.disclose`, with step-up):

- answering a person's own subject access request
- reading the audit events about monitoring

Do not give that role to anyone who assesses or decides applications.

Monitoring audit events record ids and counts only, never an answer. Only
members who hold both `platform.audit.read` and the Data protection lead role
see them in the audit log.

## Read the totals

Totals are for members with the permission `insight.monitoring.report`, which
the **Analyst** role holds. The rules below come from the platform's design.
They apply to every total.

- **Fewer than 10.** A cell that counts 1 to 9 people is not shown. It reads
  "Fewer than 10". Zero is shown.
- **Other cells are hidden too.** If only one cell in a row or column is hidden,
  someone could work it out by subtraction. So the smallest remaining cell is
  hidden too, until no row or column can be worked out. This is secondary
  suppression. A cell marked "Fewer than 10" can therefore hold more people
  than that.
- **Whole groups.** In a breakdown by outcome, a cell holding all or none of its
  group is hidden, because it would tell someone who knows one person's answer
  what happened to them.
- **Small tables.** A table with fewer than 20 responses is withheld whole:
  "Too few responses to show this report. Choose a wider filter."
- **Closed rounds.** Totals count only rounds closed for monitoring, so figures
  do not move while answers change.
- **Filters.** A report uses one filter at most: a programme, a round, or a
  financial year. Questions are never crossed with each other.
- **Repeat reports.** A report is refused if comparing it with earlier ones
  would reveal a small group. It says "This report can't be shown now, because
  it could be set against earlier reports to reveal a small group. Choose a
  wider filter."

Your funder can raise the 10 and the 20. It cannot lower them.

### Worked example

Riverside Youth Trust's programme had 134 responses to "Do you consider
yourself to be disabled?". The true counts are below.

| Answer | True count |
| --- | --- |
| Yes | 41 |
| No | 87 |
| Prefer not to say | 6 |
| Total | 134 |

"Prefer not to say" is 6, so it is hidden. If that were all, you could add Yes
and No and subtract from 134 to get 6. So the smallest shown cell, Yes, is
hidden too. The report shows:

| Answer | Shown |
| --- | --- |
| Yes | Fewer than 10 |
| No | 87 |
| Prefer not to say | Fewer than 10 |
| Total | 134 |

Yes is 41, but nothing in the report says so. Report over a wider programme or
a financial year to see more.

## Checklist

- Tell applicants in your privacy notice that you collect monitoring answers.
- Give the Data protection lead role to one or two people who do not assess
  applications.
- Report over programmes or financial years rather than single small rounds.
