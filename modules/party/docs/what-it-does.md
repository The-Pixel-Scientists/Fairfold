# What the party module does today

The party module is the master record of organisations and people. Other
modules refer to its records and do not keep their own copies. It is part of
the platform, so it is always on and cannot be switched off.

This page describes what is built in the first release. The design is in
[ADR 0017](../../../docs/adr/0017-bespoke-crm-party-core.md).

## What it holds

- **Organisations.** A name, a legal form, a website, a registered address and
  a status. The legal forms are registered charity, charitable incorporated
  organisation, company limited by guarantee, community interest company,
  community benefit society, unincorporated group or club, public body and
  other.
- **Identifiers.** An organisation can have registry numbers. The scheme and
  the number are checked together: a charity number in England and Wales
  (`GB-CHC`), Scotland (`GB-SC`) or Northern Ireland (`GB-NIC`), a Companies
  House number (`GB-COH`), or a number on the Mutuals Public Register
  (`GB-MPR`). A number that nobody has checked against the register is marked
  as not verified.
- **People.** A name and a phone number, started from the person's account the
  first time they use the portal.
- **Relationships.** A person can be a contact for an organisation. A person is
  a contact for the organisations they add.
- **Consent.** What a person agrees to be contacted about, for one purpose and
  one channel, given or withdrawn. The one purpose today is hearing about
  future funding, and the portal offers the email channel.

## What people can do with it

Applicants, in the portal:

- see and change their own name and phone number;
- add an organisation, with themselves as its contact, and list, read and
  change the organisations they are a contact for;
- give or withdraw their consent to hear about future funding.

Staff with the right to view records, through the API (the console has no
screens for them yet):

- list organisations by name, searching by name or by registry number, a page
  at a time;
- read an organisation with its identifiers and contacts;
- read a person with their organisations and contact choices.

Staff cannot change a party's record yet. Each time staff read
one organisation or one person, the audit log records it.

## What it gives other modules

The module's server entry point is what other modules call, in their own
request, so everything commits or rolls back together. It finds or starts a
person for a signed-in user, tells whether a person is a current contact for an
organisation, gives the contact details and names that staff screens and emails
need, and summarises organisations by their ids.

It also feeds the warehouse snapshot with the `organisation` and `person`
tables. The person table holds no names or contact details. See
[Load the warehouse snapshot](../../../docs/self-hosting/warehouse-snapshot.md).

## What it leaves out for now

Staff editing of organisations and people, merging duplicates, staff
verification of an identifier, more relationship types, more consent purposes
and channels, a snapshot of an organisation's details at the time of an
application, and subject access and erasure. See
[what the first release leaves out](../../../docs/demo/mvp1-known-gaps.md).
