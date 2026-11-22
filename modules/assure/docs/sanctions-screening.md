# Sanctions screening

Screening compares the names of an applicant against the UK sanctions list. It
raises a possible match when a name looks like a listed one. A possible match
is not a finding. A named person reviews every one and decides.

This guide describes the software. It is not legal advice on your sanctions
obligations. For those, read the Office of Financial Sanctions Implementation
(OFSI) guidance and ask your own adviser.

## What screening does

- **The list.** The UK sanctions list, published under the Open Government
  Licence. The software downloads it once a day. If your deployment has no
  list address set, it holds no list. Whoever runs your servers sets the
  address. See the [self-hosting quickstart](../../../docs/self-hosting/quickstart.md).
- **When it runs.** When an application is submitted, for the applicant
  organisation. The submission is never held up by it. A run can also be
  started on demand through the API, for someone who holds "Run sanctions
  screening". There is no button for this in the console yet.
- **What is compared.** Names only: the organisation's name, its registered
  names, its current contacts, and the officers and trustees in its newest
  registry copy. Names are tidied first (capitals, accents, punctuation, titles
  such as "Dr" and endings such as "Ltd" are ignored), then compared for how
  alike they are. Dates of birth, nationalities and countries are not compared.
  They are shown to you so you can judge the match.
- **A list that is out of date.** If the list was last checked more than 48
  hours before the run, the run is recorded as out of date. If there is no
  list, it is recorded as having no list. Neither is ever recorded as "no
  matches".
- **What it never does.** Nothing is rejected, held, blocked, scored or paid
  because of screening. No decision is made without a named person.
- **What is not held.** No adverse-media data and no criminal offence data.
  Politically exposed person and adverse-media checks are not part of this
  release.

## Find the possible matches

You need "View sanctions screening and match decisions".

1. Open Fairfold Due Diligence. It opens on **Possible matches**.
2. Use **Show** to choose Open, Not a match, Needs more information, Confirmed
   match or All. The list starts on Open, oldest first.
3. Read each row: when it was **Raised**, how long it has been **Waiting**,
   where the **Name from** came from (Party record, Registered name or Officer
   or trustee), what it is **Listed as** (Individual, Organisation or Ship),
   the **Similarity** and the **Status**.
4. Choose a date to open the match.

Similarity is how alike the two names are, as a percentage. It is a prompt to
look, not a score of the applicant.

## Read a possible match

The page says "This match is advisory." It shows two panels side by side.

- **Screened name**: the name from your records, and where it came from.
- **Listed entry**: the listed name, **Listed as**, **Designation**, **Regime**,
  **Designated on**, **Dates of birth**, **Nationalities** and **Country**,
  as the list published them.

Below them are the date the list was published and downloaded, and a
**Decisions** table. Opening a match is recorded in the audit log.

Compare the details, not only the name. A shared name with a different date of
birth or country is common.

## Record a decision

You need "Decide possible sanctions matches".

1. On the match, choose **Record decision**.
2. Under **Your decision**, choose one outcome.
3. Choose a **Reason** that fits. The list changes with the outcome.
4. Choose **Confirm decision**.
5. If the software asks you to confirm it is you, enter your password or code.
   You must have signed in within the last 5 minutes. Your decision is then
   saved. If you cancel, nothing is saved.

The page says "Decision recorded". It also says nothing has been rejected,
blocked or paid, and that the applicant has not been told.

### Outcomes and reasons

| Outcome               | Reasons you can give                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not a match           | The names are different; The dates of birth are different; The nationalities are different; The countries are different; One is a person and the other is an organisation |
| Needs more information | It is not clear who this is; Details are missing                                                                                                                                                              |
| Confirmed match       | The identity is confirmed                                                                                                                                                                                      |

You pick a reason from the list. There is no free text, so keep your working
notes in your own case file.

### Things to know

- A decision is under your name, taken from your sign-in. It cannot be changed
  or removed. To change your mind, record a new decision. The newest decision is
  the match's status, and every earlier one stays in the **Decisions** table.
- A match on an officer who is not yet linked to a person can only be decided
  as Not a match. Another outcome needs the officer linked to a person first.
  The console has no screen for linking yet.
- Once you decide Not a match, later runs do not raise the same listed entry
  again for the same name, unless the listed entry has changed.
- Deciding does not tell the applicant, reject them or stop a payment.

## Telling the person

Under UK GDPR Article 22, a person should not be subject to a decision made only
by automated means that has a legal or similarly significant effect. This is why
a person decides every match here.

The software sends no notice to the person who was screened. Recording a
decision keeps it private to your staff. If you need to tell someone, you do it
yourself, outside the software. What you must tell them, and when, is a matter
for your own adviser. Reporting a confirmed match to OFSI is your act too.
The software does not do it.

## Where it is recorded

Starting and finishing a run, opening a match and each decision write audit
events. They hold ids, the outcome and the reason code, never a name. See the
[audit log guide](../../../docs/admin/audit-log.md).

The software registers a retention rule for each field. Runs, matches and
decisions are kept for 6 years. The software does not yet delete data when its time passes. See
[Retention and subject access](../../../docs/admin/retention-and-subject-access.md).
