# Settings and look

Use **Settings** to set your funder's name, time zone, logo and colours. You
need the **Administrator** role. Choose **Settings** in the main navigation.
The page has these sections: **General**, **Look**, **Modules** and, for
administrators, **Single sign-on**. Modules have their [own page](modules.md).

## Change your funder's details

1. Choose **Settings**, then **General**.
2. Under **Funder details**, change any of these:
   - **Funder name**. Staff and applicants see it. It also appears in emails.
   - **Time zone**. Dates and deadlines use it. Choose a place, such as
     `Europe/London`.
   - **Financial year starts in**. Choose a month.
3. Choose **Save settings**. The page says "Settings saved." and the header
   shows the new name.

A name must contain at least one letter or number, and at most 100 characters.
It cannot contain line breaks or hidden characters.

## Add or remove a logo

1. Choose **Settings**, then **Look**. The page is called **Look and logo**.
2. Under **Logo**, choose a file in **Logo file**.
3. Choose **Upload logo**.

The file must be a PNG or WebP image of 200 KB or less, no larger than 1200
by 400 pixels. The software reads the file itself to check this. It refuses
SVG files and animated images. Choose **Remove logo** to go back to showing
your funder's name alone.

## Choose a brand colour and preset

1. Choose **Settings**, then **Look**.
2. Under **Brand colour and preset**, type a hex code, such as `#1f4bb8`, or
   pick one with **Choose a colour**.
3. Choose a **Preset**: **Standard**, **Rounded** or **Square**. They change
   the corners and the page background.
4. Check the **Preview**, then choose **Save look**.

### Colours that are too light

Text and buttons in your colour must be easy to read. The software checks
your colour against the page and against white text, to WCAG 2.2 AA. While you
type, the page shows the contrast it found, for example "Contrast found: 3.2
to 1. The minimum is 4.5 to 1."

If a colour fails, the page offers the nearest darker colour that passes, as a
button such as **Use #1b4aa0**. Choose it, or type another. You cannot save a
colour that fails. The preview keeps your saved colour until the new one
passes.

## Use your own stylesheet

A designer can set every colour, corner and size with a stylesheet. Under
**Your own stylesheet** you can download your current look, change it and save
it with **Save stylesheet**. A stylesheet must meet the same contrast rules.
**Go back to a preset** removes it. The steps and rules are in
[Write a funder stylesheet](../self-hosting/funder-stylesheet.md).

Saving a brand colour and preset after you have saved a stylesheet replaces
the stylesheet. The page asks you to confirm first.

## Where your look shows

Your name, logo and colours show in:

- the staff console;
- the applicant portal;
- your funder's pages before anyone signs in, such as the sign-in page;
- emails that use your funder's name.

## Changes are recorded

Every save on these pages is recorded twice:

- as a configuration version, which keeps who made the change and what the old
  and new values were. A logo is recorded by its type and a fingerprint, never
  the image itself;
- as an event in the [audit log](audit-log.md), such as "Tenant updated" or
  "Theme changed".

Settings changes do not ask you to confirm it is you again.

## If you cannot see Settings

You need the **Administrator** role. Anyone else sees "You cannot change this
funder's settings". Ask an administrator at your funder.
