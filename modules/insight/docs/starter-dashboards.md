# Starter dashboards

The BI service gives your analysts dashboards on your warehouse. It is
optional. This guide says what comes with it and how to open it. Operators
set it up with the [BI service guide](../../../infra/bi/README.md).

## What the BI service is

The BI service is Apache Superset, run as a separate service for one funder.
It is off unless your operator adds it. Nothing in the console or the portal
needs it.

It reads only the warehouse database loaded from your
[snapshot](loading-the-snapshot.md). It never reads the application's
database, and nothing it does writes back to any database. It cannot reject,
award or pay anything. Data is as fresh as the last snapshot, and every
dashboard shows when that was.

## Sign in

Ask your operator for the BI service's address. It has its own host name,
not the console's.

1. Open the address. You sign in through your funder's identity provider,
   which asks for multi-factor sign-in.
2. Your access depends on your identity provider's groups. Members of the
   viewer group can open dashboards and build their own. Members of the admin
   group can also manage the tool. If you are in neither, you can sign in but
   see nothing. Ask your operator to add you.

BI accounts are separate from console accounts. Giving someone a console role
does not give them the BI service, and removing them from the console does not
remove them from it. When someone leaves, the operator also removes them from
the BI groups. An open session ends within 12 hours.

## The dashboards

Each starter dashboard has a chart and a table with the same numbers beside
it. Each shows "Data as of", the time of the snapshot it was loaded from.

| Dashboard | What it answers | Reads |
| --- | --- | --- |
| Applications by round and status | How many applications each round received, and how many are accepted, waitlisted, declined, withdrawn or have no released decision | `grants_application`, `grants_round`, `programme` |
| Awards by programme and period | How much each programme has awarded, by financial year and quarter | `commitment`, `programme`, `date` |
| Funding by organisation type | How many organisations were funded, how many awards, and how much, for each type of organisation | `commitment`, `organisation` |

Things to know when you read them:

- Only released awards count. A decision that has not been released shows as
  "No decision released".
- Amounts are shown per currency and are never added across currencies.
- The dashboards use your financial year, as set in the console.

Every upgrade replaces the starter dashboards. To change one, save a copy.
Copies, and your own charts and dashboards, are kept.

## Equality and monitoring figures

Equality and monitoring figures are not in the warehouse, so no dashboard can
show them. They come only from the
[fair-funding monitoring reports](monitoring-reports.md) in the console.

## Accessibility

The BI tool's viewer has gaps. Chart content is drawn without a text
alternative, and the dashboard grid and filter bar are hard to use with a
keyboard.

To work around them, read the table beside each chart. It has the same
numbers. Charts also label their values.

The console's report tables are semantic tables, made to work with a keyboard
and a screen reader. For monitoring figures the console's table is the only
way to read them.
