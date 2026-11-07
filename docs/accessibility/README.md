# Accessibility documents

This folder holds two documents that help you publish an accessibility
statement for your deployment and keep track of known accessibility problems.

- [statement-template.md](statement-template.md) is the statement. You fill in
  the marked fields and delete the tool sections you do not run.
- [known-issues.md](known-issues.md) is the register of every known problem,
  every check still to do, and the evidence behind them.

The statement follows the wording and structure of the model statement for the
Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility
Regulations 2018. Many funders are charities and are not bound by those
regulations. We use the wording anyway because public funders need it and it is
a clear standard for everyone.

## Who completes what

The project maintains:

- the descriptions of the platform and of each tool
- the register of known issues
- the "what we are doing to improve accessibility" text

You, the operator, complete:

- your name, contact routes and response times
- the tools you run
- the content you add yourself (forms, documents and emails)
- the review dates

If you change the software, you take on the testing claims. Re-test the
changed screens and update the register before you publish the statement.

The project has not had an independent accessibility audit yet. The statement
therefore says "partially compliant". Do not change that to "fully compliant"
unless an audit supports it for your deployment.

## How to publish your statement

1. Copy `statement-template.md` to your own site or repository.
2. Replace every placeholder in square brackets (listed below).
3. Delete the sections for tools you do not run.
4. Link to your copy of the register, or to this one, from the statement.
5. Publish the statement and link to it from the footer of every page.
6. Review it at least once a year, and after any release that changes a screen
   used in a key journey.

## Placeholders

Every operator field is a placeholder in square brackets. This is the full list.
Search the template for `[` to find them all.

| Placeholder | What to write | Example |
| --- | --- | --- |
| `[Operator name]` | The organisation that runs the service. | Example Community Foundation |
| `[Service name]` | The name people see for your deployment. | Example Foundation grants |
| `[Service address]` | The web address of the service. | https://grants.example.org |
| `[Tools switched on]` | The tools you run, in the order used in the statement. | Fairfold Grants and Forms |
| `[Contact email]` | A monitored mailbox for accessibility requests. | accessibility@example.org |
| `[Contact phone]` | A phone number, with opening hours. | 020 7946 0000, Monday to Friday, 9am to 5pm |
| `[Postal address]` | Where people can write to you. | 1 Example Street, London, EX1 1AA |
| `[Response time]` | How long a reply takes, in working days. | 5 working days |
| `[Alternative format time]` | How long an alternative format takes. | 10 working days |
| `[Operator content note]` | What you know about your own forms, documents and emails. | Our guidance notes are accessible PDFs. |
| `[Date prepared]` | The day you first wrote the statement. | 12 January 2027 |
| `[Date of last review]` | The day you last reviewed it. | 12 January 2027 |
| `[Date of next review]` | The day the next review is due. | 12 January 2028 |
| `[Last tested]` | In each tool section, when that tool was last tested. | 12 January 2027 |
| `[Compliance status]` | In each tool section, fully, partially or not compliant. | Partially compliant |
| `[Tester]` | Who tested, and how. | The project's automated checks; our own manual checks |

## How the register is kept

Whoever finds a problem adds a row, at merge or after an audit. Fixed rows stay
in the table with their fix date. The statement links to the register and does
not copy it. The register's own page explains the columns.

## Tool sections and anchors

The statement and the register use the same anchors for each tool, in this
order: `#grants`, `#crm`, `#assure`, `#forms`, `#privacy` and `#insight`. Other
documents can link to those anchors. The visible headings carry the names, so a
rename changes the headings and nothing else.
