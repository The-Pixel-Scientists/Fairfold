# Team and roles

Use **Team** to decide who can sign in to the staff console and what each
person can do. You need the **Administrator** role. Choose **Team** in the main
navigation.

The page lists your **Members** with their roles and whether each is **Active**
or **Suspended**. Below that, **Invitations waiting** lists invitations that
nobody has accepted yet.

## Ask for your sign-in again

Every change on this page asks you to confirm it is you. If you signed in more
than five minutes ago, a box titled "Confirm it is you" appears. Enter your
password and the current code from your authenticator app. The change then
goes ahead. If you cancel, nothing changes.

## Invite someone

1. Choose **Invite someone**.
2. Enter their **Email address**, for example `sam@example.org`.
3. Tick every role they need. Each role shows what it allows.
4. Choose **Send invitation**.

The page says the invitation is sent and works for 7 days. The person opens
the link in the email, creates an account or signs in with the same email
address, sets up an authenticator app and accepts. Until then the invitation
stays under **Invitations waiting**. To cancel it, choose the revoke button on
its row and confirm.

If the person is already on the team, the page tells you so.

## What each role can do

A person can hold more than one role. Their permissions are the roles added
together.

| Role | What it lets someone do |
| --- | --- |
| Administrator | Change settings, switch modules, manage the team, read the audit log, download the 360Giving file and the warehouse snapshot, and save publisher details. It does not let someone read applications, record decisions or release them |
| Programme manager | Set up programmes and rounds, read and triage applications, assign reviewers, record decisions and release them, make adjustments, help applicants with their applications, and manage records of organisations and people |
| Reviewer | Score the applications assigned to them. Reviews are blind, so a reviewer never sees applicant names |
| Due diligence officer | Run and read checks on organisations before an award. Needs the Due Diligence module to be on |
| Data protection lead | Answer a person's request for monitoring data held about them. Never give this role to someone who assesses or decides on applications |
| Analyst | Build and read reports. Needs the Reporting module to be on |

The first three are the roles most funders use. The last three matter only
when their module is on.

Applicants are not invited here. They create their own accounts in the
applicant portal and hold the **Applicant** role, which only works there.

### A common trap

Administrators run the account. They do not decide grants. If you want one
person to run the account and release decisions, give them both the
**Administrator** and **Programme manager** roles.

## Change someone's role

1. Find the person in **Members** and choose **Change roles for** their name.
2. Tick the roles they should have. They need at least one.
3. Choose **Save roles**.

The page says "Roles changed for" their name, followed by the new roles.

## Suspend someone

Suspending stops a person signing in without removing them.

1. Choose **Suspend for** their name.
2. The page asks "Suspend" and their name with a question mark. Choose the
   button with their name to confirm.

They are signed out now and cannot sign in again until you reinstate them. To
let them back, choose **Reinstate for** their name.

## Remove someone

1. Choose **Remove for** their name.
2. Confirm. They are signed out now and lose their access.

Events they caused stay in the [audit log](audit-log.md). To bring them back,
invite them again.

## What the software will not let you do

- You cannot change your own membership. Ask another administrator.
- The team must always have at least one active administrator. The page
  refuses a change that would leave none.

## Password and authenticator app resets

You cannot reset another person's password or authenticator app. The team
screens only change who belongs to the team and what roles they hold. If
someone has lost their authenticator app, ask the operator.

This guide does not yet cover the page where you manage your own password and
authenticator app.

## Every change is recorded

Invitations, role changes, suspensions, reinstatements and removals each write
an event in the [audit log](audit-log.md), such as "Membership suspended" or
"Invitation sent".

## If you cannot see Team

Anyone without the **Administrator** role sees "You cannot manage the team".
