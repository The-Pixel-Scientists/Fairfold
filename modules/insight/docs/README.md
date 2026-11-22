# Fairfold Reporting guides

Fairfold Reporting turns what the other Fairfold tools hold into figures you
can use: a copy of your data for analysis, starter dashboards, fair-funding
reports with small numbers hidden, and files for regulators that a named
person checks and submits. These guides are for grants managers, analysts and
the people who host the software.

## Guides

| Guide | What it covers |
| --- | --- |
| [Data contracts](data-contracts.md) | What each tool may add to your warehouse, table by table, and what never goes in |
| [Loading the snapshot](loading-the-snapshot.md) | Download your data as a file, load it into a separate database, and look after the copy |
| [Starter dashboards](starter-dashboards.md) | The dashboards that come with the optional BI service, and what each one answers |
| [Fair-funding monitoring reports](monitoring-reports.md) | How equality figures are shown with small numbers hidden, and why |
| [The reporting autopilot](reporting-autopilot.md) | Preparing 360Giving files, a draft of the SORP grant-making note and annual return figures, for a person to check and submit |

## Before you start

Fairfold Reporting is off until an administrator switches it on. See
[Modules](../../../docs/admin/modules.md). Until then nobody at your funder can
see its screens, whatever their role.

## What you need for each task

Each task needs a permission. The table names each permission as the role
catalogue labels it, and the roles that hold it.

| Task | Permission | Roles that hold it |
| --- | --- | --- |
| Download the warehouse snapshot | Download the warehouse snapshot | Administrator |
| Read the data contract pages, run warehouse reports and read their runs | Run and view reports | Programme manager, Analyst |
| Make, change and archive reports | Set up reports | Analyst |
| Run an equality monitoring report | View equality monitoring totals, with small numbers hidden | Analyst |
| Prepare a publication or annual return figures, and mark it submitted | Prepare publications and annual returns | Analyst |
| Raise the thresholds that hide small numbers | Raise the thresholds that hide small numbers in reports | Administrator |

Reviewers hold none of these. Nobody who assesses applications sees any
individual equality answer, in any role.

An administrator gives people roles in
[Team and roles](../../../docs/admin/team-and-roles.md).

## What this release does not do

- It does not send your data anywhere. The snapshot is a file you download
  and load yourself.
- It does not refresh data on a schedule or add to it bit by bit. Each load
  replaces the last.
- It does not put personal data in the warehouse.
- It does not send anything to a regulator, 360Giving or anyone else. A named
  person submits.

The guides describe the software as it is today. They are not legal or
accounting advice.
