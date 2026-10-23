# The Fairfold Grants demo: a funding round in 16 steps

This is a script for showing a whole funding round on a laptop, on synthetic
data. A funder sets up a programme, applicants apply, reviewers score, the
funder decides privately and then releases the decisions, and the data goes
out. Then a second funder signs in and sees nothing of the first.

Every step names who does it, what to click and what you should see. The
sixteen steps are the same ones the automated journey tests run
(`e2e/journey/`), so a step that stops working shows up there first.

This is pre-release software on synthetic data. Say so when you present it.

## Before you start

### 1. Start a fresh stack with the demo funders

Follow the [quickstart](../self-hosting/quickstart.md) as far as the seed, with
the `base` scenario:

```sh
pnpm stack down --volumes
pnpm stack
pnpm stack seed base
```

`pnpm stack` prints three addresses; keep them open. This script writes them as
`<console>`, `<portal>` and `<mail>`, with your own port numbers:

| Address | Looks like | What it is |
| --- | --- | --- |
| `<console>` | `http://console.localhost:46507` | The staff console |
| `<portal>` | `http://portal.localhost:46508` | The applicant portal |
| `<mail>` | `http://127.0.0.1:46509` | Mailpit, where every email lands. Open it in its own tab |

The funders' pages are at `<console>/northfield` and `<portal>/northfield`.

### 2. The people

The seed made these accounts. They share one password, which is in the file
the seed named (see the quickstart). Nobody has an authenticator app yet.

| Funder | Name | Email | Role | Used in steps |
| --- | --- | --- | --- | --- |
| Northfield Community Trust | Sunita Rao | `sunita.rao@northfield.example` | Administrator | 2, 3, 4, 14, 15 |
| Northfield Community Trust | Ada Morgan | `ada.morgan@northfield.example` | Programme manager | 5, 6, 9, 10, 12, 13 |
| Northfield Community Trust | Owen Hughes | `owen.hughes@northfield.example` | Reviewer | 10, 11 |
| Northfield Community Trust | Priya Shah | `priya.shah@northfield.example` | Reviewer | 10, 11 |
| Eastmoor Foundation | Mei Lindqvist | `mei.lindqvist@eastmoor.example` | Programme manager | 16 |
| Eastmoor Foundation | Idris Fenwick | `idris.fenwick@eastmoor.example` | Administrator | 16 |

(The Eastmoor reviewers are Ruth Okonjo and Callum Drayton.) Applicants make
their own accounts in step 7.

### 3. Set up the way you will work

- **One private window for each staff member.** The console keeps one signed-in
  person for each browser profile, so open a private window for Sunita, another
  for Ada and another for Owen. The portal is a different address, so an
  applicant can share a window with a staff member.
- **An authenticator app on your phone.** Each staff account asks for one the
  first time it signs in, and shows a set-up key to type into the app. Add one
  entry for each account you use, and name it, such as "Sunita" and "Ada".
  Each code works once, so after you use one, wait for the app to show the
  next.
- **A test virus file** for step 8. Save this as `make-test-virus.mjs` in a
  scratch folder:

  ```js
  import { writeFileSync } from 'node:fs';

  // The standard antivirus test string, built from pieces so that this script is not itself flagged.
  const backslash = String.fromCharCode(92);
  const test = ['X5O!P%@AP[4', backslash, 'PZX54(P^)7CC)7}$EICAR-STANDARD', '-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
  const pdf = [
    '%PDF-1.4', '1 0 obj', '<< /Type /Catalog >>', 'endobj', '2 0 obj',
    `<< /Length ${test.length} >>`, 'stream', test, 'endstream', 'endobj',
    'trailer', '<< /Root 1 0 R >>', '%%EOF', '',
  ].join('\n');
  writeFileSync(process.argv[2] ?? 'invoice-from-ada.pdf', pdf);
  ```

  Run it with `node make-test-virus.mjs`. It makes `invoice-from-ada.pdf`, which
  looks like a PDF and holds the standard test string that every antivirus
  program treats as a virus. The string is harmless. **Your own antivirus
  may remove the file as soon as it exists.** If it does, exclude the scratch
  folder from scanning for the demo.
- **Two harmless files** for the accounts: any small PDF named
  `accounts-2026.pdf`, and a PNG or WebP image of 200 KB or less, no larger than
  1200 by 400 pixels, for the logo.
- **Today's date.** The seeded demo round runs 12 October to 2 November 2026.
  If you present after 2 November, give the round in step 5 dates that put
  today inside it.

### 4. If you cannot do it all live

The seeded scenarios save time. Use them to rehearse, or to start part way:

- `pnpm stack seed configured` has the programme, round, rubric, emails and a
  published form already made. Skip steps 5 and 6. Its form is different from
  the one in step 6: it asks first whether the group runs a space in
  Northfield, then the project, a budget table and an accounts file.
- `pnpm stack seed applications` has five submitted applications and one
  withdrawn, reviews partly done, and two decisions recorded but not released.
  Use it for steps 9 to 15. It has no uploaded files, so the download in step 9
  needs an application you made yourself.

The live run in this script ends up with as many applications as you make. A
few are enough to show every screen. Where the script says "five", read "the
ones you have".

## The 16 steps

### Step 1: the funders are there

Two fictional funders exist, each with its own staff and its own look.

1. Open `<portal>/northfield/sign-in`. You see **Sign in**, in the colours of
   Northfield Community Trust.
2. Open `<portal>/eastmoor/sign-in`. You see the same page for Eastmoor
   Foundation, in its own green, with rounder corners.
3. Open `<console>/northfield/sign-in`. You see the staff **Sign in** page. No
   one is signed in, so there is nothing else to see.

To start again from nothing, reset the stack (see the end of this page).

### Step 2: the administrator signs in (Sunita)

In Sunita's private window:

1. Open `<console>/northfield/forgot-password`. Enter
   `sunita.rao@northfield.example`, then choose **Email me a reset link**. You
   see **Check your email**.
2. Open `<mail>`. Open the new message to Sunita and choose the link in it.
3. Under **Password**, enter a passphrase of 12 characters or more that you
   will remember, then choose **Save new password**. You see "Your password has
   changed. Sign in with your new password."
4. Sign in with the new password. You see **Set up your authenticator app**
   and a **Set-up key**. Type the key into your authenticator app as "Sunita",
   enter the 6-digit code under **Code from your app**, then choose **Finish
   set-up**.

You are in the console. The main navigation shows **Settings**, **Team**,
**Data** and **Audit log**. Sign out and in again to show the code prompt
(**Enter your code**): a code that was used once is refused.

The seed made the staff accounts, so the reset stands in for email-first
sign-up here. Applicants sign up by email in step 7, and so does the colleague
you invite in step 14.

### Step 3: the administrator sets the funder's look (Sunita)

1. Choose **Settings**, then **Look**. The page is **Look and logo**.
2. In **Brand colour**, enter `#ffee00`. You see "This colour is too light to
   read" and "Contrast found: ... to 1. The minimum is 4.5 to 1." Choose **Save
   look**: a **There is a problem** summary appears and nothing is saved.
3. Choose the button that starts **Use #** to take the colour the page suggests.
   Under presets, choose **Rounded**, then **Save look**. You see "Look saved."
   The console takes the new colour at once.
4. Under the logo, choose your image, then **Upload logo**. You see "Logo
   saved." The logo is in the page header.
5. Open `<portal>/northfield/sign-in` in another tab. It has the same colour,
   corners and logo. `<portal>/eastmoor/sign-in` keeps Eastmoor's own look.
6. Back on the Look page, under **Your own stylesheet**, choose **Download
   stylesheet**. You get `northfield-theme.css`. Open it in an editor. Every
   value has a comment saying what it colours and what rule it meets.
7. Find `--color-muted` in the first block, which is the light scheme, and
   change its value to `#eeeeee`. Save the file. Under **Upload stylesheet**,
   choose it. The page refuses it with a line number, for example "Line 24: In
   the light scheme, muted on canvas is 1:1. It needs at least 4.5:1."
8. Put `--color-muted` back. Change the first `--color-accent` to a dark colour
   you like, such as `#0b5d3b`. Choose the file again. You see "Ready to save"
   and a preview in the light and the dark scheme. Choose **Save stylesheet**.
   You see "Stylesheet saved." The console takes the new accent.

The [funder stylesheet guide](../self-hosting/funder-stylesheet.md) has the
rules.

### Step 4: the administrator checks Grants is on (Sunita)

1. Choose **Settings**, then **Modules**. You see **Grants is on**.
2. If you want to show the switch: choose **Switch off Grants**, confirm in the
   dialog, and see **Grants is off**. Ada can no longer use the programme pages.
   Choose **Switch on Grants** to put it back. Eastmoor is not affected.

Each switch is in the audit log (step 15).

### Step 5: the manager creates the programme (Ada)

In Ada's private window, sign in at `<console>/northfield` with the seed
password. Set up her authenticator app as "Ada", as in step 2.

1. The **Programmes** page says **No programmes yet**. Choose **Create a
   programme**.
2. Enter **Title** `Community Spaces Fund` and **Summary** `Grants for places
   where neighbours meet.` Under status, choose **Open**. Choose **Create
   programme**.
3. Choose **New round**. Enter **Title** `Autumn 2026`. Under **Opening date**,
   enter day, month and year, and an **Opening time** of 09:00. Do the same for
   **Closing**, with 17:00. Enter **Budget** `150000`, **Smallest award**
   `5000` and **Largest award** `25000`. Choose **Add round**.
4. The round page shows £150,000, the dates and `Europe/London`. Choose the
   **Stages and rubrics** tab. The stages **Intake**, **Review** and
   **Decision** are already there.
5. Choose **Add rubric for Review**. Choose **Add criterion** three times and
   fill them in: `Need` weight 5, `Approach` weight 3, `Value for money` weight
   2. Each is scored 1 to 5. The total weight shows 10. Choose **Save rubric**.
   You see "Rubric saved." Choose **Back to round**.
6. Choose the programme's name in the breadcrumb, then **Edit emails**. In the
   **Accepted email**, click in the text, choose the **Organisation name**
   button to add that field, then **Save emails**. You see "Emails saved." and
   "Version 2."
7. Open the **History** tab of the round, and the **Configuration history** of
   the programme. Each change above is listed, and **See what changed** shows
   the value before and after.

**Note the round's address.** The round page's address ends in the round's id,
such as `<console>/northfield/rounds/3f2c…`. Step 6 needs it.

### Step 6: the manager builds the form (Ada)

The console has no link from the round page to the form yet, so go to it by
address: `<console>/northfield/rounds/<round id>/form`.

1. The page says **No form yet**. Choose **Create draft**.
2. Choose **Add section**. Give it the title `About your organisation` and an
   introduction. Click the blank question and build the first section:
   - `Organisation name`: under **Who sees the answer**, choose **Staff only,
     not reviewers**, and tick **Identity field: hide from blind reviewers**.
   - `Is your organisation a registered charity?`: **Type** is **Yes or no**.
     Mark **No** as the answer that stops an applicant, and under **What
     applicants are told** enter `We only fund registered charities.`
   - `Registered charity number`: choose **Add condition**, so it shows only
     when the answer above is Yes.
   - `Contact email`: **Type** is **Email address**; **Who sees the answer** is
     **Staff only, not reviewers**.
3. Choose **Add section** twice more:
   - `Your project`: a question `What will you do with the money?`, **Type**
     **Long text**, with a **Word limit** of 300.
   - `Your budget`: `How much are you asking for?` as **Amount in pounds**; then
     `What will it cost?` as **Table**, with **Name for one row** `cost`,
     **Fewest rows** 1 and **Most rows** 8, and columns `Item` (text), `Cost`
     (amount in pounds, with **Add up this column under the table** ticked) and
     `Kind` (choose one: `Staff`, `Equipment`); and `Latest accounts` as **File
     upload**, allowed as PDF and Word document only, **Largest file** 5 MB and
     **Most files** 2.
4. Choose **Save draft**. Choose the **Preview** tab. Answer **No** to the
   charity question: you see "You cannot apply with this answer" and the words
   you wrote, and no **Next section** button. Answer **Yes**: the charity number
   question appears. Go on to the budget section, add a cost row of `Hall hire`
   at `1200` and see the total £1,200. Choosing a file in the preview checks it
   but sends nothing: uploading is switched off there.
5. Choose the **Edit form** tab, then **Publish version 1**. The dialog says "A published version cannot be
   changed." Choose **Publish version 1** again. You see "Version 1, published".

### Step 7: an applicant gets ready (applicant)

In a normal window (not Ada's), on the portal:

1. Open `<portal>/northfield`. Choose **Create an account**, enter an email
   address you can invent, such as `sam@eastmere.example`, and choose **Email
   me a link**. You see **Check your email**.
2. In `<mail>`, open the message and choose the link. Enter a password, then
   **Create account**. Sign in. You see **Get ready to apply**, a list of three
   tasks that say **Not started**.
3. Choose **Your details**. Enter `Sam` and `Eastmere`, a phone number, then
   **Save details**. You see "Your details are saved."
4. Choose **Your organisations**, then **Add your organisation**. Enter the name
   `Eastmere Community Garden`; under **Type of organisation** choose
   **Registered charity**; choose **Add a charity or company number**, keep the
   type `GB-CHC` and enter `1187654`. Enter an address (`12 Mill Lane`,
   `Eastmere`, `EA1 2ST`) and choose **Add organisation**. You see "Your
   organisation is added."
5. Back on **Apply for a grant**, choose **Future funding**, choose **Yes, email
   me about future funding**, then **Save my choice**. All three tasks now say
   **Completed**.

### Step 8: the applicant applies (applicant)

1. Choose **Programmes you can apply to**, then **Read more and apply for
   Community Spaces Fund**. The page shows the closing date in UK time. Choose
   **Start application**, then **Start application** again.
2. Choose **Continue with Check you can apply**. Choose **No**. You see "You
   cannot apply with this answer" and the reason. Choose **Yes**, then **Save
   and continue**.
3. Fill in the first section. The page saves as you type ("Saved at ..."). Choose
   **Save and come back later**, then sign out. This is the first sitting.
4. Sign in again. The application says **In progress**. Choose **Continue
   application**, and the answers are there. This is the second sitting.
5. In **Your project**, paste more than 300 words. The page says "You have 1
   word too many" (or however many). Replace it with a sentence or two.
6. In **Your budget**, enter `6000` for the amount. In the table, enter `Hall
   hire`, `2500`, `Staff`, choose **Add another cost**, then `Laptops`, `3500`,
   `Equipment`. The total reads £6,000.
7. Choose **Check your answers**. A box says what is missing before you can send:
   **Latest accounts**. There is no **Submit application** button yet. Choose
   the link to that question.
8. Choose the file `invoice-from-ada.pdf`. After a few seconds you see "This
   file has a virus in it, so it was not uploaded. Check the file and try
   again." The first scan after the stack starts is slower, because ClamAV is
   loading. No file is listed, and the answers you typed are still there.
9. Choose `accounts-2026.pdf`. It is checked, and a **Download accounts-2026.pdf**
   link appears. Reload the page to show it is stored.
10. Choose **Check your answers** again. Nothing is missing. Choose **Submit
    application**. You see **Application submitted**, and the applications list
    says **Submitted**.

If you want more applications for the next steps, repeat steps 7 and 8 with
other made-up applicants (each needs its own email address), or use the
`applications` scenario (see "If you cannot do it all live").

### Step 9: the manager triages the submissions (Ada)

1. Choose **Submissions**. The table lists what has been submitted. Filter by
   **Round** `Autumn 2026` and **Status** `Submitted`. The address records the
   filters.
2. Open an application. Its **Application** tab shows the answers, the budget
   table with its total (£6,000 for Sam's) and the download link for the
   accounts. The **Eligibility** tab shows the check as **Eligible**. The
   **History** tab shows **Submitted**.
3. Choose **Download accounts-2026.pdf**. The browser saves it as a download
   and does not open it. It is sent as an attachment.
4. Go back to **Submissions** using the breadcrumb. The filters are as you left
   them.
5. Tick the rows you want to move (five, in the full demo), then in the
   **Bulk actions** bar choose **Move to stage**, choose **Review**, and
   **Move 5 submissions to Review**. A message says how many moved.
6. In step 15 the download and the moves are in the audit log.

### Step 10: the manager sets up reviewers (Ada, then Owen)

1. On **Submissions**, with the round filtered, choose **Reviewers**. (Or go to
   `<console>/northfield/rounds/<round id>/reviewers`.)
2. Tick **Owen Hughes** and **Priya Shah**, then **Add 2 reviewers**. They are in
   the pool.
3. Back on **Submissions**, filter by stage **Review**, tick the applications,
   and in **Bulk actions** choose **Assign automatically**. Choose 2 **Reviewers
   for each submission**, then **Assign 2 reviewers to each**. The dialog says
   how many reviews were assigned.
4. In Owen's private window, sign in at `<console>/northfield` and set up his
   authenticator app. Choose **My reviews**. Open one review, then choose
   **Declare a conflict**. The dialog warns that you cannot open it again.
   Confirm. The review goes from the list, and a message says you declared a
   conflict.

### Step 11: a reviewer scores (Owen)

1. In **My reviews**, open a review. The application is on screen beside the
   scoring panel. The organisation name and contact email are not shown, and no
   file link is shown. The budget table is.
2. In **Your review**, choose **I have no conflict, start scoring** if it asks.
   Click the first score and press a number, 1 to 5. Press Alt and the down
   arrow to go to the next criterion. Score all three. The panel says "Saved at
   ..." as you go.
3. Reload. The scores are still there. Choose **Submit review**. You see "Your
   review is submitted", and the scores can no longer change.
4. Sign Priya in the same way. For the spread to show, have her score the
   same application low (1) while Owen scores it high.
5. In Ada's window, open `Score spread` (the button on **Submissions** with the
   round filtered). Applications where reviewers disagree are first, marked
   **Wide spread** in words as well as colour. Choose **Show scores** on one to
   see the gap between highest and lowest.

### Step 12: the manager decides, privately (Ada)

1. Open a submission. In its **Decision** panel, choose **Record decision**,
   choose **Accepted**, enter an **Amount to award** such as `12500`, then
   **Record decision**. The panel shows "Award of £12,500" and "Private: the
   applicant sees nothing until decisions are released."
2. Do the same for another submission with `7500`.
3. Choose **All decisions in this round**. The page says "Applicants see nothing
   until you release decisions." A meter shows the awards against the budget,
   such as "£20,000 of £150,000, £130,000 left".
4. Tick two rows that have no decision, choose **Record decisions**, choose
   **Waitlisted**, then **Record 2 decisions**. A message says they are
   recorded and that only staff can see them. Do the same for **Declined**.
5. Sign in as the applicant on the portal. The application still says **Under
   review**, with no outcome.

### Step 13: the manager releases the decisions (Ada)

1. On the decisions page, choose **Release decisions**. The page shows a summary
   of what will go out and an **Email preview**.
2. Tick **I have checked the summary...**, then choose **Release decisions**.
3. The dialog **Confirm it is you** opens. Enter Ada's password and a fresh
   authenticator code. (A wrong password is refused and releases nothing.)
   Choose **Confirm it is you**.
4. A message says "Decisions released", how many emails were sent and how many
   are waiting.
5. Open `<mail>`. There is one email for each applicant. They name the programme
   and round, and an award email states the amount. None mentions scores or
   reviewers.
6. As the applicant on the portal, open **Applications** and choose **Read your
   outcome**. The page says what the decision was, and for an award, "You have
   been awarded" the amount.

### Step 14: the administrator takes the data out (Sunita)

Two files leave the console: the 360Giving file of a round's released awards,
and the warehouse snapshot. Both are on the **Data** page.

1. Choose **Data**. Under **360Giving file**, enter the publisher details: a
   **Funder identifier** such as `GB-CHC-7654321`, a **Funder name**, and a
   **Grant identifier prefix** such as `360G-northfield`. Choose **Save publisher
   details**. You see "Publisher details saved."
2. The page says "You cannot choose a programme or round". **Choosing what to
   download needs the programme manager role as well**, and the seeded
   administrator has only the Administrator role. To show the download, give
   someone both roles:
   1. Choose **Team**, then **Invite someone**. Enter an address such as
      `colleague@northfield.example`, tick **Administrator** and **Programme
      manager**, and choose **Send invitation**.
   2. In **Confirm it is you**, enter Sunita's password and a fresh code.
   3. In `<mail>`, open the invitation. In a new private window, open its link:
      you see **Join Northfield...** and are asked to create an account or sign
      in. Choose **Create an account**, enter the address, open the emailed link
      in `<mail>`, set a password, and sign in. Set up the authenticator app,
      then open the invitation link again and choose **Accept invitation**.
   4. In that person's window, choose **Data**.
3. Under **Download**, choose **Awards to include** `Autumn 2026`, then
   **Download 360Giving file**. You see "Saved 2 grants to
   360giving-community-spaces-fund-autumn-2026.json". The file lists each
   released award with the recipient's charity number. A warning lists
   recipients whose number nobody has verified.
4. Under **Warehouse snapshot**, choose **Download warehouse snapshot**. You see
   "Saved northfield-warehouse-snapshot.sql".
5. Load the snapshot into a fresh PostgreSQL and join the awards to
   organisations and dates, as in the
   [warehouse snapshot guide](../self-hosting/warehouse-snapshot.md). It lists
   each released award once, with the organisation, programme, amount and date.
   Only released awards are in either file.

### Step 15: the administrator reads the audit log (Sunita)

Open the log with its filter already in the address:
`<console>/northfield/audit-log?module=grants`. (Do not open it unfiltered; see
the note below.)

1. The table lists Grants events, newest first. Check that **Module** says
   **Grants**.
2. Under **From** and **To** enter dates that cover the round (for example,
   today's date for both), then **Apply filters**. The address records the
   filters.
3. Find **Decision released**, and choose **View details**. The dialog shows
   **Grants** and **What changed**. Press Escape to close it.
4. The Grants events cover the form publication, the moves between stages, the
   reviewer pool and assignments, the conflict, the submitted reviews, the
   decisions and their release, the emailed outcomes and the 360Giving
   download. Each module switch from step 4 and the file download from step 9
   are platform events, with the **Module** set to **Platform**. No event holds
   a name, an email address or a file name.

**Keep the filter on Grants.** The stylesheet you saved in step 3 is recorded
in a way the audit log cannot read back yet, so a page of the log that holds
it fails to load. With only a few events that is the first page of the
unfiltered log, and with the **Platform** filter it is too. The Grants filter
never meets it. This is on the
[list of what is left out](mvp1-known-gaps.md).

### Step 16: the second funder sees nothing of the first (Mei)

1. In a new private window, sign in at `<console>/eastmoor` as
   `mei.lindqvist@eastmoor.example` with the seed password. Set up her
   authenticator app as "Mei".
2. **Programmes** says **No programmes yet**. **Submissions** is empty. Nothing
   of Northfield is anywhere on the page.
3. Paste the address of a Northfield submission, programme or round into this
   window, changing `northfield` to `eastmoor`. The page finds nothing. The
   same addresses on the API answer "not found".
4. Choose **Team**: only Eastmoor's four people are listed. The audit log holds
   only Eastmoor's events.
5. The checks that prove it are automated. The isolation walk calls every
   route of the console and the portal with the first funder's ids from a second
   funder, a second applicant and a second reviewer, and expects a refusal
   every time:

   ```sh
   TPS_E2E_DEMO=1 pnpm test:stack --project journey --workers 1 e2e/journey/16b-isolation-api.spec.ts
   ```

   (It needs the state the earlier steps leave, so run it after the whole
   journey.) A second suite fails the build if any funder table has no
   cross-tenant denial test, and the database tests prove each one:

   ```sh
   pnpm test:db
   ```

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The sign-in page refuses your code | Each code works once. Wait for the next one. Check your phone's clock |
| The console signs you out | An idle session ends, after a warning. Sign in again |
| An email does not arrive | Open `<mail>` and look; the message may be there under another address. Reset links and sign-up links work once |
| The first upload takes a long time, or says "The file could not be checked" | ClamAV is still loading. Run `pnpm stack ps` and wait until `clamav` is healthy |
| A page says "Something went wrong" after a step | Reload once. If it persists, read `pnpm stack logs api` |
| The audit log does not load | It holds the stylesheet change from step 3 on that page. Open `<console>/northfield/audit-log?module=grants` |
| The 360Giving file will not let you choose a round | You need the Programme manager role as well (step 14) |

## Start again

To go back to an empty stack between runs:

```sh
pnpm stack down --volumes
pnpm stack
pnpm stack seed base
```

This deletes the database, the stored files and the secrets, and Mailpit's
messages go with the containers. The new stack has new passwords and new
authenticator keys, so delete the old entries from your authenticator app and
set them up again as each person signs in.

## Run the whole journey automatically

The sixteen steps are also end-to-end tests. On a fresh stack seeded with `base`:

```sh
TPS_E2E_DEMO=1 pnpm test:stack --project journey --workers 1
```

A stack that has been used once cannot run the journey again: reset it first.
