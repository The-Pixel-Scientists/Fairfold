# What reaches the warehouse

The warehouse is the shared store the tools feed so a funder can report across
them. This page says what forms sends it.

## Today: nothing

Forms has no data contract yet. In the platform's list of data contracts, the
slot for forms is empty, so forms adds no table and no column to the
warehouse, and a warehouse load that names forms is refused. This page lists
no columns because there are none to list.

What is built is the rule that will decide which answers a contribution may
carry. It lives in `modules/forms/src/server/warehouse.ts`.

## The rule

An answer may leave only if all of these are true:

- the version the response was answered on classifies the question **Public**
  or **Internal**;
- the question was shown to the person, given their other answers;
- the question is not a file question and is not **Only in totals**.

Everything else stays behind: **Personal** and **Special category** answers,
answers to hidden questions, anything that is not a question on the form. A
response's respondent person id, the respondent reference and its hash, the
idempotency key, the browser check and the spam reason are not answers, and
the rule never lets them through. A response marked as spam is meant to stay
out.

Every classification has a decision in the code, so adding a new level without
deciding fails the build and the test beside it.

In the feedback templates, the rating and yes or no answers are **Internal**
and could be sent. The comment answers are **Personal** and could not.

## How you can check this

- The rule: `modules/forms/src/server/warehouse.ts`, with its test beside it.
- The classification of each forms table and column:
  `packages/db/classification/forms.ts`. It covers `forms.form`,
  `forms.form_version`, `forms.response` and `forms.respondent_token`. A
  response's answers are classified question by question from the version it
  pinned, with special category as the highest level any answer can have.
- The slot: `dataContracts.forms` in `packages/domain/src/warehouse/registry.ts`
  is `null` until forms has a contract.

When forms gets a contract, this page will list each table it contributes to
with its columns, types, sources, classifications and the data-contract
version.

Only the snapshot feed is planned for the first version of forms. A feed that
updates as responses arrive comes later.
