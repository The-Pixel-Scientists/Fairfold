# Import from a CSV file

Use an import to bring organisations or people from a spreadsheet into the
shared record. You check every row first. Nothing is created until you confirm.

You need the right "Import organisations and people", and CRM must be switched
on for your funder. Starting and confirming an import ask you to confirm it is
you.

## What has a screen today

The screen shows the check and the confirm steps. It does not yet show the
upload step.

| Step | Screen | API route |
| --- | --- | --- |
| 1. Upload the file and say which column holds which field | No | Yes |
| 2. Wait for the check, then read each row's errors | Yes | Yes |
| 3. Confirm | Yes | Yes |

To start an import, your operator or developer sends the file to the platform's
file service and waits for its virus check to pass. They then start the import
with the file's id, the kind of record, whether the first row is a header, and
a column number for each field. The screen for an import is at
`/crm/imports/<import id>`.

## Get the template

Two templates match the columns CRM can import. Each holds invented example
rows only: names such as "Riverbank Community Garden", the example address
`example.org`, the postcodes `ZZ1 1ZZ` to `ZZ3 3ZZ` and the company number
`ZZ000001`. None of them is a real record. Delete the example rows before you
add your own.

- [Organisations template](csv-import-template.csv)
- [People template](csv-import-template-people.csv)

One import holds one kind of record. Import organisations and people in
separate files.

Your file may order its columns any way you like. The import reads columns by
number, as you map them, and skips the header row, so the header words are for
you. Keep the template's names so the mapping is easy to read.

## Prepare the file

- Save it as CSV in **UTF-8**. A byte order mark at the start is fine. Commas
  separate columns. Put a cell in double quotes if it holds a comma, a quote
  (write it as two quotes) or a line break.
- Keep it under 5 MB, 5,000 rows and 50 columns.
- Blank lines are ignored.
- Each row is checked by the same rules as a record typed into the shared
  record, so a value that works there works here.

### Columns for organisations

| Column | Required | What to enter |
| --- | --- | --- |
| `name` | Yes | The organisation's name. Up to 200 characters. |
| `legal_form` | Yes | A code or its words, in any case. See the list below. |
| `address_line1` | Yes | Up to 100 characters. |
| `town` | Yes | Town or city. Up to 60 characters. |
| `postcode` | Yes | A UK postcode, such as `SW1A 1AA`. Spaces and case do not matter. |
| `address_line2` | No | Up to 100 characters. |
| `country_code` | No | Two letters, such as `GB`. Blank means `GB`. A postcode outside the UK is checked more loosely. |
| `website` | No | A link that starts with `https://` and has no user name or password. |
| `identifier_scheme` | No | One of `GB-CHC`, `GB-SC`, `GB-NIC`, `GB-COH` or `GB-MPR`, in any case. |
| `identifier` | No | The number, in the format of its register. Needs a scheme. |

Legal forms:

| Code | Words |
| --- | --- |
| `registered_charity` | Registered charity |
| `charitable_incorporated_organisation` | Charitable incorporated organisation (CIO) |
| `company_limited_by_guarantee` | Company limited by guarantee |
| `community_interest_company` | Community interest company (CIC) |
| `community_benefit_society` | Community benefit society |
| `unincorporated_group` | Unincorporated group or club |
| `public_body` | Public body |
| `other` | Other |

An import carries at most one identifier for each organisation. Add more to the
record afterwards.

### Columns for people

| Column | Required | What to enter |
| --- | --- | --- |
| `given_name` | Yes | Up to 100 characters. |
| `family_name` | Yes | Up to 100 characters. |
| `email` | Yes | A valid email address. |
| `phone` | No | Digits, spaces, brackets and hyphens, with an optional leading `+`, holding 10 to 15 digits. |

## Check the file

While the file is read, the page says "Waiting to check the file" or "Checking
the file", and refreshes by itself every few seconds. When it is ready, the
page says "Ready to import" and shows "Check the rows": how many rows are in
the file, how many are ready, how many have errors and how many are likely
duplicates.

Each row shows a status:

- **Ready.** The row would create a record.
- **Has errors.** The row says what to fix, in the form "Row 4, postcode:
  Correct this value in the file so it is in the expected format." Rows with
  errors are always skipped.
- **Likely duplicate.** The row looks like an existing record, and a link
  opens it. See [Duplicates and merging](duplicates-and-merging.md) for how
  records are matched.

Row numbers are the row's place in the file, counting the header row. A
message never repeats your value.

Opening the rows is a sensitive read. It writes the audit event
"crm.import.previewed", because the rows hold personal details.

### Row errors

| Message | What it means and how to fix it |
| --- | --- |
| Fill in this field in the file. | A required column is empty. Fill it in. |
| Shorten this value in the file. | The value is longer than the field allows. |
| Correct this value in the file so it is in the expected format. | The value is not valid, such as a postcode, email address, website, phone number or identifier that fails its register's format. |
| Change this value in the file to one from the list of allowed values. | A legal form, identifier register or country is not one the import knows. |
| Remove line breaks and hidden characters from this value in the file. | The cell holds a line break or an invisible character. |
| Remove the =, +, -, @ or tab at the start of this value in the file. | The cell starts like a spreadsheet formula. See below. |
| Remove the repeated row from the file. | An earlier row has the same email address (people) or the same name and postcode (organisations). |

A row shows at most one error for each field.

### Cells that start like a formula

A cell that starts with `=` or `@`, a tab or a carriage return, or with `+` or
`-` followed by anything other than digits, spaces, brackets and hyphens, is
refused. A phone number such as `+44 7700 900001` is fine.

The import does not treat such a cell as text. It gives the row the formula
error above and does not store the cell's value, so a spreadsheet program
cannot run it as a formula if the data is exported later. Remove the leading
character and upload the file again.

### If the whole file fails

The page says "The file could not be used" and why. Fix the file and start a
new import.

| Message | What to do |
| --- | --- |
| The file could not be read. Check that it opens in a spreadsheet, then upload it again. | Open it, save it again as CSV, and retry. |
| The file is not a CSV file. Save it as CSV from your spreadsheet, then upload it again. | Save as CSV in UTF-8. A file that is not UTF-8, or has a stray quote, fails here. |
| The file is larger than 5 MB. Split it into smaller files and upload each one. | Split the file. |
| The file has more than 5000 rows. Split it into smaller files and upload each one. | Split the file. |
| The file has more than 50 columns. Remove the columns you do not need, then upload it again. | Delete columns you do not import. |
| The file has no rows to import. Add the records below the header row, then upload it again. | Add rows. |

## Confirm the import

1. Read the counts. You cannot fix a row on screen. To import a corrected row,
   fix your file and upload it as a new import.
2. If some rows are likely duplicates, choose under **Likely duplicates**:
   "Skip 2 rows that look like existing records" (the default) or "Add 2 rows
   as new records".
3. Choose **Import 5 organisations** (or **Import 5 people**). The number is
   how many records will be created.
4. Confirm it is you when asked.

Nothing is created before step 3. The screen says: "An import does not verify
numbers, merge records or send anything."

When it finishes, the page says "Imported 5 organisations" and how many rows
were skipped. Choose **Open records** to see the new records.

Confirming is all or nothing. If anything fails, no record is created and you
can confirm again. Confirming a finished import is refused with "This import is
not ready to confirm. Wait for the check to finish, or start a new import if it
failed."

## What an import does and does not do

- **A named member confirms.** No timer or job confirms an import.
- **Identifiers arrive unverified.** An import never verifies one. See
  [Verify an identifier](verification.md).
- **Nothing is linked or merged.** An import never links a person to an
  organisation, merges records, records consent or creates an account. It
  sends nothing.
- **Each record is audited.** Every created record writes the audit event
  "party.organisation.created" or "party.person.created" with your name and
  the field names, never the values. The import itself writes
  "crm.import.started" and "crm.import.confirmed", with ids and counts only.

## Run the same file again

Each upload is its own import, so running a file twice can make duplicates.
What protects you is the check:

- On the second run, the records the first run made are found as existing
  records. Their rows show "Likely duplicate" and are skipped, as long as you
  keep the default to skip.
- The check matches on the signals described in
  [Duplicates and merging](duplicates-and-merging.md). A record those rules do
  not catch can be created twice. Read the "Likely duplicates" count before
  you confirm.
- If you choose "Add rows as new records", duplicates are created.

Within one file, a repeated row is an error, as above.

## How long import rows are kept

Import rows hold the cells from your file, which are personal data. The
platform keeps a row for at least 30 days after its import last changed. An
import record, which shows who imported what and keeps the uploaded file, is
kept for at least 90 days, and is removed once none of its rows are left. An
administrator may set longer times, up to 90 days for rows and 366 days for
import records. No one can set them shorter than the minimum.

The platform has a retention routine that removes expired rows and writes an
audit event each time. Ask your operator to confirm it runs on your
deployment. If a person is erased, the cells of every import row about them are
emptied. The records the import created are kept as long as any other record.

## Rules restated

- **Tenant isolation.** You see only your funder's imports and rows.
- **Audit.** Starting, reading and confirming an import, and each record it
  creates, are audited.
- **Humans decide.** A member starts and confirms every import.
- **Retention.** As above, set by the field classification map.
