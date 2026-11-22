# Reasonable adjustments

Some applicants need something different to apply. Fairfold Grants gives you
two ways to help: more time, and an alternative route where your staff submit
the application for the applicant. This guide shows how to give them, what the
applicant sees, and what the audit log records.

The Equality Act 2010 says organisations must make reasonable adjustments for
disabled people. Read the guidance from the Equality and Human Rights
Commission for what that means for your funder. This guide does not give legal
advice.

You need the **Programme manager** role. The permission to give and remove
adjustments is `grants.adjustments.manage`. The permission to start and submit
an application for an applicant is `grants.applications.assist`.

## The two kinds

**More time** sets a new closing time for one organisation in a round. Use it
when an applicant needs longer than everyone else. The new time must be after
the round's own closing time and must not have passed. You can set it for the
organisation's application in the round, or for one named application.

**An alternative route** lets your staff start, fill in and submit the
application for an organisation, in the console. Use it when an applicant
cannot use the online portal. An organisation can have only one live
application in a round, so you cannot start a second one for it.

Neither kind changes a status, a score or a decision. People still make every
decision.

## Give more time

You can start from a round or from a submission.

1. Open the round, then choose the **More time and adjustments** tab. Or open a
   submission and find **More time and adjustments** on its page.
2. Choose **Give more time**. From the round, you first choose the organisation
   by name or number.
3. Read the line "It closes ... now". It shows the round's own closing time, or
   the application's current one.
4. Enter the **New closing date** and **New closing time**. The time is in your
   funder's time zone, which the form names ("UK time").
5. Choose a **Reason**. See the reason list below.
6. Choose **Give more time**.

If the closing time is missing, has passed, or is not after the round's own
closing time, the form tells you to enter a new date and time.

The application closes at the latest closing time of its live extensions. If it
has none, it closes at the round's own time. Reminders and the late policy
follow the new closing time. An application submitted inside its extension is
not flagged as late.

## Give an alternative route

1. Open the round and choose the **More time and adjustments** tab. Or open a
   submission and use its **More time and adjustments** panel.
2. Choose **Let staff submit for an organisation** (on a round) or **Let staff
   submit for them** (on a submission).
3. Choose a **Reason**.
4. Choose **Allow staff to submit**.

The route is for the organisation in that round. It stays until you remove it.

## See and remove adjustments

The round's **More time and adjustments** tab lists every adjustment in the
round, with the organisation. A submission's panel lists the adjustments that
apply to it and shows when it closes. Each row shows what was given, the
reason, who gave it and when.

To remove one:

1. Choose **Remove** on its row.
2. Choose why you are removing it. The choices are "No longer needed", "The
   applicant asked", "Given by mistake" and "Another reason".
3. Choose **Remove adjustment**. Choose **Keep adjustment** to leave it.

Removing cannot be undone, and you cannot edit an adjustment. To give it again,
give a new one. A removed adjustment stays in the list, marked **Removed**.

## What the applicant sees

An applicant with more time sees "You have more time to apply" and their own
new deadline in UK time. They never see the reason, the kind of adjustment, or
who gave it. They do not see other organisations' adjustments.

## Reasons

You choose a reason from a fixed list. There is no free-text reason field.

| Reason | Label |
| --- | --- |
| `access_needs` | Access needs |
| `caring_responsibilities` | Caring responsibilities |
| `technical_problem` | Technical problem |
| `bereavement` | Bereavement |
| `other` | Another reason |

The reasons are broad on purpose. None names a condition. They are still
special category data, because "Access needs" can hint at health. Only staff who
can manage adjustments see them, on the round tab and on a submission. They
never appear in the audit log.

Do not write health or personal details in notes or messages to explain an
adjustment. The reason list is the record.

## Submit for an applicant

Start from the **More time and adjustments** tab of a round. The tab shows
**Start application** on each organisation that has the alternative route, if
you hold `grants.applications.assist`.

1. Choose **Start application** for the organisation.
2. In **Start an application for an applicant**, choose **Who is applying?**
   from the organisation's current contacts. If it has none, add a contact to
   the organisation first.
3. Choose **Start application for** the organisation. Fairfold Grants asks you
   to confirm your identity again (step-up) if you have not done so in the last
   5 minutes.
4. Fill in the answers. A banner at the top names the organisation and the
   applicant: "You are filling in this application for Riverside Youth Trust on
   behalf of Sam Example. They will be told you submitted it."
5. Choose **Save answers**, or **Save and check answers**.
6. On **Check before you submit**, read the eligibility result and the list of
   questions still to answer. Choose **Go to question** to fix one.
7. Choose **Submit application for** the organisation. You confirm your
   identity again if needed.

Drafts staff are filling in appear in **Applications staff are filling in** on
the round tab, with **Continue**. They do not appear in the submissions list
or in the applicant's portal until you submit.

The rules are the same as for the applicant's own submission. The application
uses the same form version, validation, eligibility check, closing time and
late policy. It cannot be submitted if the applicant would be stopped by an
eligibility question or has a required question unanswered.

The applicant stays the applicant. The organisation and the contact you chose
do not change. Fairfold Grants records you, from your session, as the person
who submitted it. It never takes your name from the request.

The applicant sees "The funder sent this application for you" in the portal,
with the time it was sent and **See what was sent**, which shows exactly what
was submitted. They are not shown your name. You do not see or fill in the
equality monitoring questions. The applicant is invited to answer them
themselves.

## What the audit log records

These events are written with the member who did it and the time. None holds an
answer, a reason or free text.

| Action | When | What it records |
| --- | --- | --- |
| `grants.adjustment.granted` | You give more time or the alternative route | The adjustment, round, organisation, application (if named) and kind |
| `grants.adjustment.revoked` | You remove an adjustment | The adjustment, round, organisation, kind and who removed it |
| `grants.application.created` | You start an application for an applicant | The new application |
| `grants.application.answers_saved_on_behalf` | You save answers | The application, the new answers version and the field ids that changed, never a value |
| `grants.application.submitted` | You submit | The status change, stage and whether it was late |
| `grants.application.submitted_on_behalf` | You submit | The organisation and the member who submitted |

An administrator reads them in the **Audit log**: see the
[audit log guide](../../../docs/admin/audit-log.md). Filter by module and
action.

## Checklist

- Give the smallest adjustment that helps, and remove it when it ends.
- Choose the reason that fits. Do not add detail elsewhere.
- Check the closing time and the time zone before you choose **Give more time**.
- Use the alternative route only for an applicant who asked or needs it.
