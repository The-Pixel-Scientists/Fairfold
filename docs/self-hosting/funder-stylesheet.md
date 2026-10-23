# Write a funder stylesheet

This page is for a funder's designer. It shows how to take the look of your
Fairfold Grants site as a stylesheet, change it, and put it back, with the
rules your changes must meet. The rules keep the console and the portal
readable for everyone (WCAG 2.2 AA), whatever you choose.

A stylesheet sits beside the three presets on the Look page. It does not
replace the preset system: a preset with a brand colour is the quick way, and
a stylesheet is for a funder whose designer wants to set every colour, corner
and size.

## Before you start

- You need an account with the **Administrator** role at the funder. Only
  administrators can change the look.
- You need a text editor. The file is plain text.
- Nothing is saved until you choose **Save stylesheet**, so you can try as
  often as you like.

## Download the stylesheet

1. Sign in to the console and choose **Settings**, then **Look**. The page is
   called **Look and logo**.
2. Find **Your own stylesheet** and choose **Download stylesheet**.

You get one file named after your funder's address, such as
`northfield-theme.css`. It holds your look as it is now. If you have not saved
a stylesheet before, that is your preset and brand colour, worked out as values.
Every value has a comment above it that says what it colours and what rule it
must meet.

## What is in the file

The file has three blocks. Keep every block, and every value in it, exactly
once.

| Block | Holds | Applies to |
| --- | --- | --- |
| `:root` | The light colours, the corner radii and the font | The console and the portal |
| `:root[data-scheme='dark']` | The dark colours, with the same names as the light ones | The console and the portal, when someone chooses the dark scheme |
| `[data-density='comfortable']` | Text sizes and spacing | The portal only. The console keeps its compact sizes |

The start of a downloaded file looks like this:

```css
/* Light colours, corners and the font, in both apps. */
:root {
  /* The page, behind every panel. Text and controls on it are checked against it. */
  --color-canvas: #f7f7f5;
  /* Body text and headings. Needs at least 4.5:1 on canvas, surface, sunken, ... */
  --color-ink: #17181b;
  /* ...and so on for every colour. */
  --radius-md: 0.375rem;
  --font-sans: atkinson;
}
```

### The colours

Light and dark use the same 22 names. A colour is a hex code with six digits,
like `#1f4bb8`. The comment above each value in your file has the full rule; in
short:

| Token | What it colours | Rule |
| --- | --- | --- |
| `--color-canvas`, `--color-surface`, `--color-sunken` | The page, panels and fields, and areas set into a panel | The three surfaces that text sits on |
| `--color-ink` | Body text and headings | At least 4.5:1 on every surface and every soft colour |
| `--color-muted` | Hints, labels and other secondary text | At least 4.5:1 on the surfaces and on `--color-accent-soft` |
| `--color-edge` | The outlines of fields and other controls | At least 3:1 on the surfaces |
| `--color-divider` | Lines between rows and sections | None. It is decoration |
| `--color-accent` | Links, main buttons and the current page | At least 4.5:1 on the surfaces and `--color-accent-soft`, and 3:1 on the surfaces |
| `--color-accent-hover`, `--color-accent-soft` | Main buttons under the pointer; behind the current page in navigation | Checked through the colours that sit on them |
| `--color-on-accent` | Text on main buttons | At least 4.5:1 on `--color-accent` and `--color-accent-hover` |
| `--color-danger` | Errors and buttons that delete | At least 4.5:1 on the surfaces and `--color-danger-soft`, and 3:1 on the surfaces |
| `--color-danger-hover`, `--color-danger-soft` | Delete buttons under the pointer; behind error messages | Checked through the colours that sit on them |
| `--color-on-danger` | Text on buttons that delete | At least 4.5:1 on `--color-danger` and `--color-danger-hover` |
| `--color-success`, `--color-warning`, `--color-info` | Success, warning and information messages | At least 4.5:1 on `--color-surface` and their own soft colour |
| `--color-success-soft`, `--color-warning-soft`, `--color-info-soft` | Behind those messages | Checked through the colours that sit on them |
| `--color-focus` | The focus ring round whatever the keyboard is on | At least 3:1 on the surfaces and every soft colour |

Both schemes are checked, so a dark scheme that fails stops the file even if
the light one is perfect.

### The corners, font, text sizes and spacing

Lengths are written in `rem` with up to three decimal places, like `1.125rem`,
or as a plain `0`. One `rem` is the reader's own text size, so a reader who
makes their text bigger gets bigger corners and spacing too.

| Token | What it sets | Allowed |
| --- | --- | --- |
| `--radius-sm`, `--radius-md`, `--radius-lg` | Corners: small things such as tags, buttons and fields, and panels and dialogs | 0 to 1.5rem. Each at least the one before |
| `--font-sans` | The font | `atkinson` (Atkinson Hyperlegible Next) or `system` (the device's own font) |
| `--text-xs` to `--text-4xl` | The eight text sizes | 0.75rem to 3rem, and each at least the size before. `--text-base` is at least 1rem |
| `--text-xs--line-height` to `--text-4xl--line-height` | The line height of each size | 0.75rem to 6rem, and between 1.4 and 2 times its size for `sm` and `base`, and between 1.1 and 2 times for the rest |
| `--density-control-height` | The height of buttons and fields | 2.5rem to 3.5rem, so a button stays easy to tap |
| `--density-control-px` | Space either side of a button's text | 0.5rem to 1.5rem |
| `--density-body-size` | Body text | 1rem to 1.25rem |
| `--density-body-leading` | Line height of body text | Between 1.4 and 2 times `--density-body-size` |
| `--density-gutter`, `--density-stack`, `--density-field-gap` | Space round the page, between sections, and between a label and its field | 0.25rem to 3rem |

Only those two fonts are allowed. Another font needs its licence checked and
added to the product first.

### What the file must not contain

The file holds the three blocks and a value for each token, and nothing else.
These are refused, each with its line:

- any rule or selector other than the three blocks, and any `@` rule such as
  `@import`;
- `url()`, `var()` or any other function;
- `!important`, and a backslash anywhere in a value;
- a block or token twice, a missing token, or a token the product does not know;
- a colour that is not a six-digit hex code, a length that is not in `rem`,
  or a font that is not on the list;
- a file over 32 KB, or one whose name does not end in `.css`.

Comments are fine, and you can add your own, but they are not kept. The next
download is written afresh from the saved look.

## Upload the stylesheet

1. On the same page, under **Upload stylesheet**, choose your edited file.
2. The page reads it at once. If it is right, you see **Ready to save**,
   followed by the file's name, and a **Preview of the uploaded stylesheet** in
   the light and the dark scheme. Nothing has changed yet.
3. Choose **Save stylesheet**. You see **Stylesheet saved.** The console takes
   the new look straight away, and the portal takes it the next time a page
   loads.

The page checks the file in your browser, then the server checks every value
again before it uses any of it. The server never reads your file as CSS: it
receives the values, and writes them into the stylesheet it serves, so nothing
you type can add a rule.

If your look comes from a stylesheet, the Look page says so, and the preset and
brand colour on the same page are not in use. Saving a preset or a brand
colour on that page asks first, because it removes your stylesheet. To go back
yourself, choose **Go back to a preset**.

## How problems are reported

If the file has problems, nothing is previewed or saved. A **There is a
problem** summary appears at the top of the form and lists every problem, each
with the line it is on. Choose the file again after you fix them. These are separate examples, each
from a different mistake:

```
Line 22: Enter the colour as a hex code, like #1f4bb8.
Line 62: Enter a length in rem, like 1.125rem, with up to three decimal places, or 0.
Line 66: Enter atkinson or system.
Line 22: Remove !important. Every token applies as it is.
Line 66: Add --color-ink to this block.
```

A contrast problem says which pair failed and by how much, and its line is the
line of the colour that needs to change. For example, with `--color-muted`
changed to `#eeeeee`, the page reports:

```
Line 24: In the light scheme, muted on canvas is 1:1. It needs at least 4.5:1.
```

A problem with the whole file has no line: a name that does not end in `.css`,
a file over 32 KB, or a block missing altogether (for example "Add the :root
block back, with every token in it.").

## Tips

- Change the accent first. It carries links, main buttons and the current
  page, and it has the most rules.
- Change a light colour and its dark partner together, then read the preview of
  both.
- Keep the soft colours (`-soft`) light in the light scheme and dark in the
  dark one: text sits on them.
- The logo is separate. Upload it in the logo section of the same page.
- Download the stylesheet before you go back to a preset or save a new brand
  colour, if you want to keep your work.

## What this does not do

Full custom CSS for the portal, with your own rules and selectors, is not
available yet. The stylesheet changes values only.
