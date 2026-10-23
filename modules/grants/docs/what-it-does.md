# What the grants module does today

The grants module runs one funding round from start to finish. A funder sets up
a programme and a round, builds the application form, takes applications,
checks eligibility, has reviewers score them blind, records decisions
privately, releases them to the applicants, and exports the result. It is on by
default, and a funder's administrator can switch it off for that funder. Its
data stays and comes back when it is switched on again.

This page describes what is built in the first release. For a walk through it
on a laptop, see [the demo script](../../../docs/demo/mvp1-demo.md).

## What a funder can do

**Set up.** A programme manager creates a programme (a title, a summary, a
status) and adds rounds to it. A round has opening and closing times in the
funder's time zone, a budget, the smallest and largest award, and a policy for
applications that arrive late: refuse them, or accept and flag them. A round
starts with three stages (Intake, Review and Decision), which can be renamed,
added to and reordered. The Review stage has a rubric of weighted criteria,
each scored 1 to 5. Each programme has the outcome emails for accepted,
waitlisted and declined applications, with merge fields such as the
organisation's name. Every change to a programme, round, stage, rubric or email
is kept in a configuration history, with who made it and what changed.

**Build the form.** A round has an application form made of sections of
questions. The question types are short and long text (with limits on
characters or words), numbers, amounts in pounds, yes or no, one or several
choices, dates, email addresses, phone numbers, web addresses, UK addresses,
explanatory text, a table (rows of columns, with a column that can be totalled)
and a file upload (with the types, size and number of files set for the
question). A question can be required, can
show only when an earlier answer says so, and can be an eligibility question
that stops an applicant who gives the wrong answer and tells them why. Each
question says who sees its answer (applicants, staff and reviewers), and can be
marked as an identity field that blind reviewers never see. The manager previews
the form as an applicant sees it, then publishes it as a fixed version. A
published version cannot change, and every application keeps the version it was
started on.

**Take applications.** Applicants see the programmes with a round open, start an
application for one of their organisations, and answer over as many sittings as
they like. Answers save as they type. Eligibility is checked as they go. Files
are checked for type and size, scanned for viruses and stored only if clean.
Before submitting, the applicant sees what is missing. A submitted application
can be withdrawn until its decision is released.

**Triage.** Staff list the submissions, filter them by programme, round, stage,
status, eligibility and lateness, read one with its answers, its files, its
eligibility checks and its history, download its files (each download is
audited), and move up to 200 at a time into another stage.

**Assess.** A manager builds a reviewer pool for a round from the team members
who can review, and assigns reviewers to submissions by hand or automatically,
balancing the open work. Reviews are blind: a reviewer sees the answers that the
form shows reviewers, never an identity field or a file. A reviewer declares a
conflict, which ends the assignment, or scores each criterion by keyboard and
submits. The manager sees the spread of weighted scores for each submission.

**Decide and release.** A manager records a decision for a submission (accepted
with an amount, waitlisted or declined), singly or up to 200 at a time. A
decision is private: the applicant sees nothing, and no email goes. Releasing
them is a separate step that needs the manager to confirm it is them again, and
it emails the applicants. Emails that fail can be sent again.

**Take the data out.** An administrator saves the funder's 360Giving publisher
details and downloads a 360Giving file of a programme's or round's released
awards. The module also feeds the warehouse snapshot with rounds, applications
and scores. Both leave out anything personal and anything not yet released. See
[Load the warehouse snapshot](../../../docs/self-hosting/warehouse-snapshot.md).

## Who can do what

| Role | Can |
| --- | --- |
| Programme manager | Set up programmes, rounds and forms; read, triage and assign submissions; record decisions; release them |
| Reviewer | Score the applications assigned to them, blind |
| Administrator | Export 360Giving and the warehouse snapshot, and manage the team and settings |
| Applicant | Apply for open rounds, and read their own applications and outcomes |

Every route checks the permission and the scope on the server. A second funder,
or a second applicant or reviewer in the same funder, gets "not found" for
records that are not theirs.

## What it records

State changes, decisions, assignments, conflicts, reviews, file downloads and
exports write an audit event. Staff reads of an application are audited. An
applicant's autosaves are not: submission is.

## What it leaves out for now

Messaging, notes, saved views, owners and labels; reminders; CSV export and
board packs; scheduled and incremental feeds; exporting and importing a
programme's configuration; browsing programmes before signing in. See
[what the first release leaves out](../../../docs/demo/mvp1-known-gaps.md).
