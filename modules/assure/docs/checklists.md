# Checklists

A due diligence checklist is a list of checks, such as "Has the organisation
filed its latest accounts?". You build it once. Staff then answer it for each
application.

Checklists are configuration. Every version you publish is kept, so you can
always see what was asked when an application was checked.

## Create a checklist

You need "Set up due diligence checklists".

1. Open **Checklists** and choose **Create checklist**.
2. Enter a **Name**, and optionally a **Description**.
3. Under **Items**, fill in each item:
   - **Check**: the question or check, up to 200 characters.
   - **Help text**: optional guidance for the person answering.
   - **Answer kind**: Yes or no, Date or Short text.
   - **Answer required**: tick it if the item must be answered.
4. Choose **Add item** for more. Use **Move item up**, **Move item down** and
   **Remove item** to arrange them. A checklist holds 1 to 100 items.
5. Choose **Review and create**, check the summary, then choose
   **Create checklist**.

The page says "Version 1 published".

A checklist is not tied to a programme. It is available for every
application.

## Publish a new version

A published version cannot be edited. To change a checklist, publish a new
one.

1. In **Checklists**, open the checklist.
2. Change its name, description or items.
3. Choose **Review and publish**. The dialog lists what changes.
4. Choose **Publish new version**.

What this does:

- The new version becomes the one staff answer from then on.
- Earlier versions are kept unchanged.
- Answers already saved stay with the version they answered. An application's
  answers are not moved to the new version.
- Each item keeps its own id across versions, so its answers stay with it.

If you change an item's **Answer kind**, the item becomes a new question.
Earlier answers stay with the old one.

If someone else published a version while you were editing, the page says
"The checklist has changed". Choose **Reload checklist** and make your change
again.

## Archive a checklist

Archiving is not available yet. There is no **Archive checklist** button.
Nothing in checklists is deleted.

## Answer a checklist for an application

You need "Complete due diligence checklists".

1. Open the application's **Due diligence** page. The **Due diligence
   checklist** panel is under the possible duplicates.
2. If there is more than one checklist, choose one in **Checklist**.
3. The panel says which version you are answering, for example "Answering
   version 2 of Charity checks", and when it was last saved.
4. Answer each item. The answer kinds are:
   - **Yes or no**: Yes, No or Not applicable.
   - **Date**.
   - **Short text**: up to 500 characters.
5. Choose **Save answers**. The panel says "Answers saved."

The panel shows **Complete** when every required item is answered, otherwise
**Not complete**. You can save part way and come back.

Once an application has answers, it keeps answering the version it started on.
A newer version does not change those questions.

File answers are not available yet. Do not attach files to a checklist.

Answers are personal data. Keep to what the check needs, and keep health and
other sensitive details out of short text answers.

## Where the history is recorded

Every version is recorded as a configuration version with its author and its
changes. A diff lists the names and fields that changed, never an answer. No
screen shows this history yet. Creating and publishing, and each save of
answers, also write audit events that hold ids only. See the
[audit log guide](../../../docs/admin/audit-log.md).

Checklists are kept as long as your funder is. Answers stay with the
application they belong to. The software does not yet delete data when its time
passes. See
[Retention and subject access](../../../docs/admin/retention-and-subject-access.md).
