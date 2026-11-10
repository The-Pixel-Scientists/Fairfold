# Exports

Choose **Data** in the main navigation to download your data in open formats.
The page offers two downloads. Neither holds personal details, and only awards
you have released are included.

## Who can download

| Download | Permission | Roles that have it |
| --- | --- | --- |
| 360Giving file | Export grants data | Administrator |
| Warehouse snapshot | Export the warehouse | Administrator |

To choose which programme or round goes in the 360Giving file, you also need
the **Programme manager** role. Without it the page says "You cannot choose a
programme or round".

Anyone without either permission sees "You cannot download data".

Both downloads are recorded in the [audit log](audit-log.md). Neither asks you
to confirm it is you again.

## The 360Giving file

Save your [publisher details](publishing-360giving.md) first.

1. Under **360Giving file**, find **Download**.
2. In **Awards to include**, choose all of a programme's rounds, or one round.
3. Choose **Download 360Giving file**.
4. The page says how many grants it saved and the file's name, such as
   `360giving-community-spaces-fund-all-rounds.json`.

### What is in the file

One grant for each released award: an accepted decision whose release has
happened. Each grant has:

- an identifier built from your prefix;
- the round's title and the programme's summary;
- the amount and the date it was awarded, in your time zone;
- the recipient's name and identifier, with its charity or company number
  where there is one;
- your funder identifier and name, and the programme title.

### What is left out

- anything an applicant wrote;
- contact names, email addresses and phone numbers;
- scores, comments and notes;
- awards that have not been released.

### Check the identifiers

The page shows a summary. If any recipient's identifier has not been verified
by someone on your staff, it lists them under a heading such as "2 recipients
have an identifier nobody has verified" and says "Check these before you
publish the file." A recipient with no identifier at all is published under
your prefix and appears in the same list.

A file holds at most 5,000 grants. If you have more, choose one round at a
time.

If the programme or round has no released awards, the page says, for example, "Community Spaces Fund,
all rounds has no released awards yet". Release decisions first. See [Releasing decisions](releasing-decisions.md).

## The warehouse snapshot

One SQL file with a copy of your data as it stands now. Load it into
PostgreSQL 16 or later to ask your own questions. It does not update. Download
a new one when you want fresh numbers.

1. Under **Warehouse snapshot**, choose **Download warehouse snapshot**.
2. The page says "Saved" with the file's name.

### What is in the snapshot

- organisations, and people without their names or contact details;
- programmes, rounds, and the applications made to them, without their
  answers;
- scores, without reviewers' comments;
- the awards you have released, as commitments;
- a date table that follows your financial year.

**Show the tables** lists each table and what it holds.

### What is left out

- personal details of any kind;
- anything an applicant wrote;
- decisions that have not been released.

If your data makes a file over 50 MB, the page says so and asks you to contact
the operator for a copy.

How to load the file is in
[Load the warehouse snapshot into PostgreSQL](../self-hosting/warehouse-snapshot.md).

## Not yet available

- CSV export of a saved view of applications: not yet available.
- Board packs: not yet available.
