# Anonymous forms and spam

An anonymous form is a published form whose **Who can answer** setting is
**Anyone** or **Anyone, signed in or not**. Nobody needs an account. Use one
when you want feedback from people who would not create an account to give it,
such as someone who used a service once. Use **People who sign in** when you
need to know who answered.

## What a respondent sees

The page is `/<your-slug>/forms/<form id>` on your portal address. The form id
is the last part of the address when you open the form in the console. There
is no sign-in and no navigation, and the page sets no cookie and sends none.

- **Answers stay on the device.** While the person types, the page keeps their
  answers in their browser, and says "Your answers stay on this device".
  Nothing reaches the funder until they choose **Send my answers**.
  **Clear my answers** removes them from the device. On a browser that does
  not let the page keep answers, the page says "Your answers are not kept".
- **A short check runs while they answer.** The browser does a small
  calculation in the background. Nobody solves a puzzle, reads distorted text
  or picks pictures, so it works with a keyboard and a screen reader. If the
  check is still running when they send, the page says "Checking your answers
  before sending. This can take a few seconds."
- **Limits.** The service limits how often one network, one form and one
  funder can send in an hour. A person sending in good faith will not meet
  them. The page does not say which limit was reached.
- **No second response from one click.** Each send carries a one-time key. If
  the connection drops and the person sends again, the service recognises the
  retry and does not store a second response.
- **A reference.** After sending, the page shows "Your reference", made in
  their browser. It tells them to keep it and quote it if they ask the funder
  to find or remove their answers.

Anonymous forms cannot ask for files, and cannot have **Only in totals**
questions. Publishing is refused if they do. See
[Publish a form](publishing.md).

## What the funder keeps

- The service stores a keyed hash of the reference, never the reference. It
  cannot show the reference again, and the console never shows one. If a
  person loses it, you cannot look their response up.
- An anonymous response is linked to no person record.
- No client address, reference or key is written to the audit log. The audit
  event for a sent response is recorded as the system, with the request id.
- Responses are kept for at most 12 months.

The service can find a response from its reference through the API
(`POST /console/form-responses/lookup`, a sensitive read that is audited). The
console has no screen for it yet.

## Mark a response as spam

Staff with the permission to mark form responses as spam do this from a
response.

1. Open **Forms**, open the form, choose **Responses**, then open a response.
2. Choose **Mark as spam**.
3. In "Mark this response as spam?" choose a reason under "Why is it spam?":
   "Sent by a script or bot", "Abusive", "Not about this form", "A duplicate"
   or "A test".
4. Choose **Mark as spam**, or **Keep as received** to cancel.

The response is kept. It stops showing in the received list, and it is left
out of exports and reports. To undo, open it from **Show: Marked as spam** and
choose **Mark as not spam**.

Nothing in the software marks, scores, rejects or removes a response by
itself. A response sent without the browser check is tagged "Sent without the
browser check" for staff to judge. If the operator has switched that fallback
on, a person whose browser could not finish the check in time can still send,
under tighter limits. Staff decide what to do with those.

Marking and unmarking write audit events with the reason code.

## What the operator does

The operator sets up the keys the service uses for the check and for hashing,
and chooses whether the fallback is allowed. These guides do not describe
them. Keep the keys secret and out of the repository.
