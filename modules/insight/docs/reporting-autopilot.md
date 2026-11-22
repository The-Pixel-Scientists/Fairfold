# The reporting autopilot

The reporting autopilot prepares the figures and files that funders have to
publish or report each year, so you do not build them by hand. A named person
at your funder then checks each one and submits it.

**The software never sends anything to 360Giving, the Charity Commission or
anyone else.** It prepares a file. A person checks it, submits it outside the
software, and then records that they did. "Mark as submitted" only records
that.

## What it prepares

Each prepared item is a run, for a period you choose.

| Kind | What you get |
| --- | --- |
| 360Giving publication | A 360Giving file of your released awards in the period |
| SORP grant-making note | A draft of the grant-making note for your accounts |
| Annual return | The grant figures the Charity Commission annual return asks for |

For each kind you give a start date and an end date. The end date must be
after the start date.

Every run counts only awards whose decisions were released in the period.
A decision you have recorded but not released is never included.

## Prepare a run

You need the **Prepare publications and annual returns** permission. Analysts
have it.

1. Open the publication page in Fairfold Reporting.
2. Choose **Prepare a run**.
3. Choose the kind, then enter **Period start** and **Period end**.
4. Choose **Prepare a run** to confirm. The run appears in the list as
   "Preparing".

Preparing takes place in the background. Open the run to see it. The page
shows "Ready to review" when it is done. Choose **Check again** to refresh
it. If it shows "Could not be prepared", the page says why. Check the period
and try again.

## Review and download

1. Open a run that shows "Ready to review".
2. Read what the page says about the run. For a 360Giving file it says how many
   recipients are published without a verified identifier.
3. Choose **Download file**. Every download is recorded in the
   [audit log](../../../docs/admin/audit-log.md).
4. Check the file against your records, as below.

## Mark it submitted

Do this only after a person at your funder has submitted the file.

1. Open the run and choose **Mark as submitted**.
2. The dialog says the software has not sent anything and that you are
   recording that you submitted it yourself. Choose **Record that I submitted
   this**.
3. The page then shows your name and the time. You may be asked to confirm
   your sign-in again first.

Only a run that is ready to review can be marked. The record is your
statement. It is written to the audit log as
"insight.publication_run.submitted", with the member and the run. It does not
change any grant, decision or application.

## 360Giving files

A 360Giving file holds one grant for each released award in the period.

- **Only verified identifiers are published.** A recipient's charity or
  company number appears only if a member of staff has verified it on the
  organisation's record. A recipient without a verified identifier is
  published under your grant identifier prefix and the organisation's id,
  with no charity or company number. The grant is still included.
- **Check the count.** The run's page says how many recipients have no
  verified identifier. To fix them, verify each identifier on the
  organisation's record, then prepare a new run.
- **Your publisher details** are printed in every file. Save them first, as
  described in
  [Publishing to 360Giving](../../../docs/admin/publishing-360giving.md).
- Choose the licence you publish your data under yourself. It is your
  decision, not the software's.

The file holds no names or contact details of people. The
[exports guide](../../../docs/admin/exports.md) describes the 360Giving file
you can download from the **Data** page.

## The SORP note and annual return figures

These are drafts. They give totals and counts of the grants committed in the
period. The SORP draft groups them by programme, and shows grants to
organisations apart from grants to individuals, who are never named. Each
figure states what it counts and the period it covers.

Check them before you use them:

- Figures are grants committed on release. They are not payments made.
- Money is added up in each currency separately, never across currencies.
- Compare each figure with your accounts, and have your trustees or
  accountants check the draft.
- The SORP note and annual return ask for more than grant figures. The
  autopilot does not prepare the rest.

This guide is not accounting or legal advice. Follow the regulator's current
guidance for what to report.

## What the software provides and what you provide

The software provides the preparation, the filter that leaves out unreleased
decisions and unverified identifiers, the audit record of each run, download
and submission, and the check that only a prepared run can be marked.

You provide the checking, the submission, and the accuracy of what is
submitted in your name.
