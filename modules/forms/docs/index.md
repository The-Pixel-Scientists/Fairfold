# Forms

Forms lets a funder collect answers outside a grant application: feedback from
the people it supports, event surveys, check-ins. Staff build a form, publish
it, and read the responses. People answer either after signing in to the
applicant portal or, for a form open to anyone, with no account at all.

It uses the same form engine as grant applications, so questions, branching,
required answers and "who sees this answer" work the same way.

## Who these guides are for

- **Staff** who build forms and read responses: start with
  [Build a form](building-forms.md).
- **Data protection leads and data people**: read
  [Anonymous forms and spam](anonymous-forms-and-spam.md),
  [Responses and totals](responses-and-totals.md) and
  [What reaches the warehouse](warehouse-data-contract.md).
- **People who run the platform**: read the [launch check](launch-check.md).

## What forms does

- Build a form with sections and questions, including questions that show only
  after an earlier answer. See [Build a form](building-forms.md).
- Preview the draft without storing anything.
- Publish a form as a fixed, numbered version. See
  [Publish a form](publishing.md).
- Take answers from people who sign in, from anyone, or from both. See
  [Anonymous forms and spam](anonymous-forms-and-spam.md).
- Start from one of three feedback templates. See
  [Feedback templates](feedback-templates.md).
- List, filter and read responses, mark spam, and see counts. See
  [Responses and totals](responses-and-totals.md).

## Switch forms on

No tool is on by default. An administrator switches forms on as described in
[Modules](../../../docs/admin/modules.md). Once it is on, **Forms** appears in
the console for members who hold a forms permission.

While forms is off, its screens are hidden and its addresses answer "not
found". Switching it off keeps its data; the data returns when you switch it
back on.

## Who can do what

| Permission                              | What it allows                                   | Held by default   |
| --------------------------------------- | ------------------------------------------------ | ----------------- |
| Build forms and change their settings   | Create, edit, preview and change settings        | Programme manager |
| Publish forms                           | Publish a draft as a new version                 | Programme manager |
| View form responses                     | List and read responses, see counts              | Programme manager |
| Mark form responses as spam             | Mark and unmark spam                             | Programme manager |
| Change how long form responses are kept | Change retention (asks you to confirm it is you) | Administrator     |
| Answer forms                            | Answer in the portal                             | Applicant         |

Another funder's forms and responses are never visible to you. Every table
forms uses is isolated by tenant in the database, not only in the screens.

## What is built today

This is the state of the code these guides were written against. Check it
against the release you run.

- Built: the forms contracts, the staff screens, the pages for people who
  answer, and the portal's embed page.
- The API does not register the forms routes yet. The screens call routes
  that the API has to answer, so a running service does not serve forms until
  it does. The anonymous-submission handlers are a module the API has to
  register.
- Embedding on your own website is not available yet. See
  [Embed a form](embedding.md).
- Forms does not send any data to the warehouse yet. See
  [What reaches the warehouse](warehouse-data-contract.md).
- Expired responses are not deleted automatically yet. See
  [Responses and totals](responses-and-totals.md).

## Guides

1. [Build a form](building-forms.md)
2. [Publish a form](publishing.md)
3. [Anonymous forms and spam](anonymous-forms-and-spam.md)
4. [Embed a form](embedding.md)
5. [Feedback templates](feedback-templates.md)
6. [Responses and totals](responses-and-totals.md)
7. [What reaches the warehouse](warehouse-data-contract.md)
8. [Launch check](launch-check.md)
