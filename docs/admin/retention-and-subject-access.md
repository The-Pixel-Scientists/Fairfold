# Retention and subject access

This page covers three things: how long Fairfold Grants keeps data, how to
answer a subject access request, and how to erase a person's data. You need the
**Administrator** role. The screens are under **Settings**, in **Data
retention** and **Subject access and erasure**. You only see a section if you
hold its permission.

Each change asks you to confirm it is you first. If you signed in more than
five minutes ago, a box titled "Confirm it is you" asks for your password and
the current code from your authenticator app.

## How long data is kept

Every field the software stores is registered with a sensitivity and a
retention rule. The rule says how long the data is kept and what happens at the
end.

- **Audit events** are kept for at least 12 months. This is a platform minimum.
  No funder can set it lower, and only a software release can change it.
- Most other data follows a fixed rule set by the software. You cannot change
  it.
- A few kinds of data have a period you can change.

### Change a retention period

1. Choose **Settings**, then **Data retention**.
2. Find the kind of data. The table shows **Kept for**, the **Platform
   minimum**, the **Default** and **Set by** (your funder, or the default).
3. Choose **Change period** on its row.
4. Under **Days to keep**, enter a whole number of days.
5. Choose **Save period**.

The page says the period is saved. The kinds with a changeable period are the
audit log (minimum 365 days), contact import rows (minimum 30 days) and contact
import jobs (minimum 90 days). You can make a period longer or shorter, but
never shorter than its platform minimum. The longest you can enter is 36,500
days.

What happens next:

- A nightly job, at about 03:30 UK time, deletes or anonymises data past its
  period and records what it did.
- A shorter period applies from the next nightly run. Data past the new period
  is then removed, and cannot be brought back.
- A changed audit log period applies only to events recorded after the change.

The change is recorded in the audit log and the configuration history.

You are responsible for what you tell people about retention. Write your own
retention policy and check it matches these settings.

## When a person asks for their data

A person can ask what you hold about them. This is a subject access request.
There is a legal deadline, so act the day it arrives. The screens gather the
data. You decide what to send.

1. Write down who asked, what they asked for, and the date you received it.
2. Check who is asking. Do not release anything to someone you have not
   checked.
3. Choose **Settings**, then **Subject access and erasure**.
4. Under **Name or email address**, search for the person and choose their
   name.
5. Under **Subject access export**, choose **Create subject access export**.
6. Confirm it is you if asked. The next page says the export is waiting to
   start, then being made. It updates by itself and usually takes a few minutes.
7. When the page says "Your export is ready", choose **Download export
   (JSON)**.
8. Check what you have gathered before you send it. It may name other people.
9. Keep a record of what you sent and when.

The export holds everything your funder stores about the person in every tool,
including tools that are switched off, as one JSON file. It may hold sensitive
and special category data, so handle it securely.

Who can do what:

- Only the **Administrator** role holds the permission to create an export, and
  creating one needs step-up.
- Only the person who created the export can download it.
- The file is deleted after 7 days. The page then says the export has been
  deleted. Find the person and create a new one.
- If the export fails, the page says no file was made. Create it again.

The software does not keep your record of the request. Your own notes are that
record.

## When a person asks you to erase their data

Erasure removes or anonymises a person's personal data in every tool.
**It cannot be undone.** Check the request first, including who is asking and
whether you must keep some of the data.

1. Choose **Settings**, then **Subject access and erasure**.
2. Search for the person and choose their name.
3. Under **Erasure**, choose the button to continue. The next page lists what
   will happen.
4. Under **Why is this data being erased?**, choose **The person asked for
   their data to be erased** or **Your funder has decided to erase it**.
5. Tick **I understand this cannot be undone**.
6. Choose the button to erase. Confirm it is you if asked.

The next page says the erasure is waiting to start or running, and updates by itself.
When it finishes it says "The personal data is erased" and lists the rows
changed in each table. If it does not finish, the page says nothing was erased.

What happens:

- Their personal data is removed or anonymised in every tool, including tools
  that are switched off.
- Their record is kept but marked as erased.
- Applications, scores, decisions and the audit trail are kept, with ids and
  codes only. No outcome changes. The audit trail is a true record, so it keeps
  the ids of who did what. It does not keep the erased person's details.
- The erasure is recorded. If the operator restores a backup, the restore
  re-applies the erasure, so the data does not come back.

Only the **Administrator** role holds the permission to erase, and starting an
erasure needs step-up.

## What the operator must do

The operator runs the nightly retention job and the backups. Older backups may
still hold erased data until they expire. Tell people this if they ask. The
operator restores from backup by the [restore runbook](../runbooks/restore.md),
which re-applies erasures.
