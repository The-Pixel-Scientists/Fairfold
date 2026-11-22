# Records of processing

Use this guide to read and complete your record of processing. You need the
`privacy.processing.manage` permission. UK GDPR Article 30 requires most
controllers to keep this record. Confirm your duties with your own data
protection adviser.

Open **Data Protection**, then **Records of processing**. The page has three
parts: the generated record, your processing activities and your processors.

## Read the generated record

The **Generated record** is read only. The software builds it from the field
classification map, which registers every database column with a sensitivity
and a retention rule. It is the same for every funder and contains no personal
data. Each row is a table, and shows:

- the tool that owns it, including tools that are switched off, because their
  data is still kept;
- the kinds of data;
- the highest sensitivity of any field in it;
- how long it is kept, using the longest rule of any field in it;
- the fields that reach a person, which are the paths used to find a person's
  data for export and erasure;
- the purpose and lawful basis.

A column reading "Not set" means the map has no value for it yet. The
**Processors** column reads "None" until the platform's own processors are
filled in.

A new field cannot ship unclassified. A software check fails until every column
has a sensitivity and a retention rule, so the record cannot silently miss a
field. If you host the software yourself, a release that changes the map
changes this record.

## Add a processing activity

The generated record cannot know why you collect data, who gets it or how you
keep it safe. You add that by hand as a processing activity.

1. Choose **Add activity**.
2. Enter a **Name**, such as "Paying grant holders".
3. Enter **What the data is used for**.
4. Choose a **Lawful basis**: Consent, Contract, Legal obligation, Vital
   interests, Public task, Legitimate interests or Recognised legitimate
   interests.
5. If special category data is involved, choose a **Condition for special
   category data**.
6. Choose the kinds of data and whose data it is (for example Applicants or
   Grant holders), and the processors involved.
7. Enter **Who receives it**, **Transfers abroad**, **How long you keep it** and
   **How you keep it secure**.
8. Choose **Save activity**.

To change an activity, choose **Edit** beside it. Saving records a new version
of your records of processing. Choose the lawful basis with your adviser. The
tool does not check that it is right.

## Add a processor

A processor handles personal data for you, such as a hosting provider.

1. In **Processors**, choose to add one.
2. Enter **Name** and **What they do for you**.
3. Enter **Country**: a two-letter code in capitals, such as GB.
4. Enter **Contract signed on** and, for a transfer abroad, the **Transfer
   safeguard**: Adequacy regulations, International data transfer agreement, UK
   addendum or Binding corporate rules.
5. Choose **Save processor**.

## What the software provides and what you provide

The software provides the generated record and a place for your own entries,
and writes an audit event when an activity or processor changes. You provide
the purposes, lawful bases, processors, contracts and transfer safeguards. They
are your decisions.

## Next

- [Impact assessments](dpias.md)
