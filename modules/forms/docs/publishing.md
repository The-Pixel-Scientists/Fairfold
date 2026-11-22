# Publish a form

Publishing turns the saved draft into a numbered version that people answer.
A published version cannot be changed. To change the form, you edit the draft
and publish again, which makes the next version.

## Set who can answer, and when

Open the form, then choose **Form settings**.

1. **Title** and **Description**. People see the description under the title.
2. **Who can answer** has three choices: **People who sign in**, **Anyone**
   and **Anyone, signed in or not**.
3. **Opens** and **Closes** are optional and are in UK time. Leave **Opens**
   empty to open when you publish. Leave **Closes** empty to keep the form
   open. The closing time must be after the opening time.
4. **Confirmation message** is optional. People see it after they send their
   answers. If you leave it empty, they see "Thank you. We have your answers."
5. Choose **Save settings**. The page says "Settings saved."

Forms that anyone can answer cannot ask for files or answers counted only in
totals. See [Anonymous forms and spam](anonymous-forms-and-spam.md).

A calm, honest confirmation message says what happens next and what is kept.
For example: "Thank you. We read every response. We keep your answers for 12
months."

## Publish

1. Open the form and choose **Publish form**. The builder saves the draft
   first.
2. The dialog is titled "Publish version 2?" (with the next number). It
   repeats that a published version cannot be changed and shows who can
   answer.
3. Choose **Publish form** to confirm, or **Keep editing**.

The page then says "Version 2 is published." A form with no published version
says "Not published yet. Nobody can answer until you publish it."

Each response keeps the version it was answered on. Changing the form later
never alters old answers. If you publish while someone is answering without
an account, the page tells them "This form changed while you were answering"
and asks them to check their answers and send again. It keeps their answers to
questions that still exist.

## When publishing is refused

The server compares the draft with every version published before it. It
refuses to publish if:

- a question's type changed. The message is "This question had another type
  when it was published. Change it back, or add a new question instead."
- a question's sensitivity was lowered. The message is "This question was
  published with a higher classification. Set it back, or add a new question
  instead."
- the form can be answered by anyone and has a file question or an **Only in
  totals** question. The messages are "Forms anyone can answer cannot ask for
  files. Remove this question, or let only people who sign in answer." and the
  same for questions only counted in reports.

The builder also warns about a lowered sensitivity before you try. Each
problem shows next to its question. To fix a changed type or a lowered
sensitivity, set it back and add a new question for what you wanted. Removing
a question and adding a new one is allowed.

## Who can answer is fixed with each version

The **Who can answer** setting in force when you publish is recorded on that
version. If you change it, publish again for the change to apply to new
answers.

## How long responses are kept

Under **How long responses are kept**, **Months to keep responses** accepts
1 to 120. A new form keeps responses for 12 months. A form that anyone can
answer can keep them for 12 months or less, because nobody can be identified
to ask what they want. If you try to set more, the page says "Keep responses
to a form anyone can answer for 12 months or less. Shorten how long they are
kept first."

Choose **Change retention**. You are asked to confirm it is you, and only
members with the permission to change how long form responses are kept (the
administrator by default) can do it. Shortening retention can remove
responses, which is why it is separate from building forms.

The database sets each response's end date when it is sent, and no screen or
route changes it. Deleting responses when that date passes is not available
yet; see [Responses and totals](responses-and-totals.md).

## Rules that apply

- Each version, and each change of settings or retention, is recorded in the
  audit log. A publication records the version number, never the content of
  the form.
- Settings changes are versioned configuration with author and history.
- Another funder cannot publish, change or see your forms.
