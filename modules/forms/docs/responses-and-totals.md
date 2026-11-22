# Responses and totals

Staff with the permission to view form responses read them under **Forms**,
by opening a form and choosing **Responses**.

## Read responses

The page shows a totals table, filters, and a list of responses, the newest
first. Choose **Show more responses** for older ones.

1. Use **Show** to choose **Received**, **Sent without the browser check** or
   **Marked as spam**.
2. Narrow the list with **How sent** (**Signed in**, **Anonymous** or **Either
   way**), **Version**, **From** and **To**. Days are in UK time. **Clear
   filters** resets them. Filters are kept in memory only, never in the
   address, because a filter can name people.
3. Choose a response's received time to open it.

A response shows when it was received, which version it answered, how it was
sent, its state, and the answers you may read.

## What staff can see

- Staff see each answer only if its **Who sees the answer** setting includes
  staff. The server decides this from the version the response was answered
  on. The screen does not fill in or guess an answer the server left out.
- Special category answers are always **Only in totals**, so staff never see
  them on a response. Neither do they see any other **Only in totals** answer.
- Files are never shown on a response.
- A response never shows the reference a person was given, any hash of it,
  the idempotency key, the browser check or anything about the person's
  network.
- A signed-in response is linked to the person who answered. An anonymous one
  is linked to nobody.

Opening a response is a sensitive read and writes an audit event
(`forms.response.viewed`). The list itself does not.

## Totals

The table above the list counts responses that match your filters:
**Received**, **Signed in**, **Anonymous**, **Sent without the browser
check** and **Marked as spam**.

Totals count responses, never answers. That has two consequences today:

- No screen counts or charts an answer, so an **Only in totals** answer is
  collected and stored but not shown anywhere in forms yet.
- The counts are not rounded or hidden when they are small. Rules that hide
  small counts apply to equality and monitoring reports in the insight tool,
  not to this table. If you need to avoid identifying someone from a small
  count, do not share the table when a form has few responses.

## How long responses are kept, and requests from respondents

A response is kept for the months set on the form (12 by default, at most 12
for a form anyone can answer). The database sets the end date when the
response is sent, and nobody can change it afterwards. See
[Publish a form](publishing.md).

Today, nothing deletes a response when its date passes. The platform's
routine that removes expired data does not cover forms yet. Until it does, the
operator must delete expired responses, and you should not tell people they
are deleted automatically.

When a person asks for their data or to be erased, the platform's own
request process applies, and the database has a forms step that clears a
signed-in person's answers above internal sensitivity. There are no screens
for these requests yet, so the operator does the work. A signed-in respondent
is found through their person record. An anonymous respondent is found only
by the reference they were given, which is why the confirmation page asks them
to keep it. See
[Retention and subject access](../../../docs/admin/retention-and-subject-access.md).

## Rules that apply

- Another funder's responses are never visible, to staff or in the API.
- Reading a response, marking and unmarking spam, and sending a response are
  audited.
- Every response stays pinned to the form version it was answered on.
- Humans decide. Nothing marks, hides or removes a response without a named
  member of staff.
