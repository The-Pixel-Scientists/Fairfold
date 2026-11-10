# Publishing to 360Giving

360Giving is an open standard for publishing who a funder funds. Before
Fairfold Grants can make a 360Giving file for you, it needs your publisher
details. This page shows how to save them. [Exports](exports.md) shows how to
download the file.

You need the **Administrator** role.

## Save your publisher details

1. Choose **Data** in the main navigation.
2. Find the **360Giving file** panel and its **Publisher details** step.
3. Fill in the three fields:

   | Field | What to enter | Example |
   | --- | --- | --- |
   | **Funder identifier** | Your organisation identifier from org-id.guide | `GB-CHC-0000000` |
   | **Funder name** | The name to publish | `Northfield Community Trust` |
   | **Grant identifier prefix** | The prefix 360Giving gave you, starting `360G-` | `360G-northfield` |

4. Choose **Save publisher details**. The page says "Publisher details
   saved."

These details are public. Every file prints them. Enter only what you want
published.

## What the form checks

- **Funder identifier**: two capital letters, a hyphen, a register code, a
  hyphen and the number. For example `GB-CHC-0000000` or `GB-COH-00000000`.
  Otherwise the page says "Enter the funder's identifier from org-id.guide,
  like GB-CHC-1234567."
- **Funder name**: not empty, at most 200 characters, with no line breaks or
  hidden characters. Otherwise: "Enter the funder's name as it should be
  published." or "Remove line breaks and hidden characters."
- **Grant identifier prefix**: starts with `360G-`, followed by letters,
  numbers or hyphens. Otherwise: "Enter the prefix 360Giving gave the funder,
  like 360G-northfield."

The form checks the format only. It does not look the identifier up, so check
it against org-id.guide yourself.

## Change them later

Change a field and choose **Save publisher details** again. Files you made
earlier do not change. A new file uses the new details.

Each save writes a configuration version, with the old and new values, and an
event in the [audit log](audit-log.md): "Publisher setting changed".

## Until you save them

The **Download** step shows "Save your publisher details first". The file
prints them, so it cannot be made without them.
