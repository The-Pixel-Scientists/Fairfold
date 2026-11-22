# 360-converter: the Fairfold 360Giving converter

The Fairfold 360Giving converter turns a spreadsheet of grants to
organisations, saved as CSV, into a [360Giving](https://www.threesixtygiving.org/)
JSON file you can publish. It is for funders whose grants are in a
spreadsheet rather than in Fairfold Grants. It builds each grant with the
same rules as the 360Giving export in Fairfold Grants, so the two write the
same file for the same grants.

It complements 360Giving's own
[data quality tool](https://dataquality.threesixtygiving.org/), which makes
the full check of a file. Check every file there before you publish it.

## What it does and does not do

It does:

- read one UTF-8 CSV laid out as [template.csv](template.csv);
- check every row, and list every problem by row number and column;
- write the 360Giving JSON to standard output or to the file you name, and
  a short summary to standard error.

It does not:

- publish grants to individuals: a row without a recipient organisation, or
  a column for individual recipients, is refused;
- check identifiers against the charity and company registers, so the
  summary counts every recipient identifier as unchecked;
- write any part of a file when a row has a problem;
- read XLSX or other spreadsheet formats, or convert 360Giving files back to
  CSV.

## Your data stays with you

The converter makes no network call and collects nothing: no telemetry, no
update check, no cache and no settings file. The only file it writes is the
one you name with `--output`. The tests run it with the network stubbed to
fail and with the operating system's permission to write only that file.

## Fill in the template

Save [template.csv](template.csv) as your starting point. Columns can be in
any order, and their names in any case. Any other column is refused.

| Column | What to enter |
| --- | --- |
| Grant reference | Your reference for the grant, with no spaces, like `NF-2027-001`. The grant's 360Giving id is your prefix, a hyphen and this reference, so each reference must be different. |
| Title | The grant's title, up to 120 characters. |
| Description | What the grant is for, up to 300 characters. |
| Amount | The amount awarded in pounds, like `2500` or `2500.50`, with no £ sign or commas. |
| Currency | `GBP`. |
| Award date | The date of the award, like `2027-05-14`. |
| Recipient organisation name | The organisation's name, up to 200 characters. |
| Recipient identifier | The organisation's number on its register, like `1234567` for a charity in England and Wales. |
| Recipient scheme | The register: `GB-CHC` (Charity Commission for England and Wales), `GB-SC` (Scottish Charity Regulator), `GB-NIC` (Charity Commission for Northern Ireland), `GB-COH` (Companies House) or `GB-MPR` (Mutuals Public Register). |
| Programme title | The programme the grant is from, up to 120 characters. |

Save the file from your spreadsheet as "CSV UTF-8". A file can hold up to
50,000 grants; split a larger one and convert each part.

## Run it

You need Node.js 24 or later and a checkout of this repository with its
dependencies installed (`pnpm install`). There is no build step.

```sh
node tools/360-converter/src/cli.ts grants.csv \
  --funder-name "Northfield Foundation" \
  --funder-identifier GB-CHC-7654321 \
  --identifier-prefix 360G-northfield \
  --output grants.json
```

- `--funder-name`: the funder's name as it should be published.
- `--funder-identifier`: the funder's identifier from
  [org-id.guide](https://org-id.guide/), like `GB-CHC-7654321`.
- `--identifier-prefix`: the prefix 360Giving gave the funder, like
  `360G-northfield`.
- `--output`: the file to write. Without it, the JSON goes to standard
  output.
- `--help`: shows these options.

The command ends with status 0 when it wrote a file, and 1 when it did not.

## The schema it checks

Each grant is checked against the schema the 360Giving export in Fairfold
Grants uses: the fields of the 360Giving Data Standard (version 1.4) that the
export publishes, in `modules/grants/src/contracts/export/`. The official
360Giving schema is not bundled with this version, so run the data quality
tool for the full check.

### Dependency record (ADR 0002)

| Item | Record |
| --- | --- |
| Dependencies | None from outside this repository. The CSV reader is `src/csv.ts`, and options are read with Node.js's `parseArgs`. |
| Official 360Giving schema | Not bundled. Its licence has not yet been read from the licence file in 360Giving's standard repository, so no source URL, version, commit or date is recorded. It is bundled, with its licence text and attribution, only once that record is made and the licence allows redistribution in an AGPL-3.0-or-later tool. |

## Licence

AGPL-3.0-or-later, as the rest of this repository. See
[LICENSE](../../LICENSE).
