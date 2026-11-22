# Onboard a funder

Use this page to create a funder (a tenant), choose which tools it can use and
invite its first administrator.

## When to use this

A funder has signed its agreement and asked to start. Run this once per funder.
For the first funder in a new cell, do [Go live with a managed cell](go-live.md)
first.

## Before you start

- You are a platform operator on a machine inside the cell's network, with the
  settings the command reads: the database settings, `TPS_CONSOLE_ORIGIN` and
  the `TPS_SMTP_*` mail settings. [Go live with a managed cell](go-live.md),
  step 5, says where they come from.
- The funder's signed agreement is filed outside the database. Check it exists.
- You have the funder's chosen **slug**: 3 to 40 lower case letters, numbers
  and single hyphens, starting with a letter, for example `harbour-trust`.
  It becomes part of every console and portal address and is public. It is
  unique in the cell and only an operator can change it.
- You have the funder's display name and the address of its first
  administrator. Take the address from the agreement, and type it only into the
  command. Do not put it in a ticket.
- You know which tools the funder has agreed to use. The tools are `grants`,
  `crm`, `assure`, `forms`, `privacy`, `insight` and `impact` (Fairfold Grants,
  CRM, Due Diligence, Forms, Data Protection, Reporting and Impact). No tool is
  on unless you list it. Organisations and people, and the platform, are always
  on.

## Steps

1. **Run the command.** Example with synthetic values:

   ```sh
   pnpm tenant:create --slug harbour-trust --name "Harbour Trust" --admin-email admin@example.org --modules grants,forms
   ```

   Leave out `--modules` to start with every tool off. The command checks the
   slug, name, address and module list first and writes nothing if one is
   wrong. A taken slug prints "That slug is already taken. Choose another."
   The managed service has no `pnpm` script that supplies its settings: run
   `node apps/api/src/operator/create-tenant.ts` with the same arguments and
   settings, as in the go-live runbook.
2. **Read the output.** It prints "Created tenant harbour-trust" with the
   tenant id, then "Invited the first administrator by email." It never prints
   a link or a token. Write down the tenant id in the record.
3. **Tell the funder's administrator to look for the email.** The invitation
   link works for 7 days. They set a password and an authenticator app, then
   accept.

## Switch tools on or off later

- The funder's administrator can do it under **Settings**, then **Modules**.
  See [Modules](../admin/modules.md).
- Each switch writes a configuration version and an audit event ("Module
  switched on" or "Module switched off"), with the person who made it.
- Switching a tool off hides its screens and makes its addresses return "not
  found". Nothing is deleted. Switching it on again brings everything back.
- Running `tenant:create` again does not change a tenant that exists. To add a
  tool for a funder that cannot reach the screen, ask the engineering lead:
  there is no operator command for it.

## Check it worked

1. The administrator accepts the invitation and signs in at the console
   address for the slug, for example `https://<console host>/harbour-trust`.
2. The funder's portal address for the slug loads, with the funder's name.
3. Under **Settings**, **Modules**, each tool you listed is on and each other
   tool is off.
4. A page of a tool that is off, such as `/harbour-trust/grants` when grants is
   off, shows "not found".
5. The funder's colours and logo, if it has set them, appear on the sign-in
   page. The default look applies until it does.
6. The funder's **Audit log** holds "Module switched on" for each tool you
   listed.

## If something goes wrong

- The command prints "The first administrator has not been invited. Check the
  mail and database settings." The tenant exists. Fix the mail settings. Then
  ask the engineering lead how to invite the administrator, or create a second
  tenant with a new slug if the first has no use. Do not edit the database.
- "The tenant could not be created, and nothing was written." Check the
  database settings and the migration status of the cell, then run again.
- The invitation expired: the funder cannot invite itself yet. Ask the
  engineering lead.
- A tool you listed is missing: the module list has only the tools above. A
  misspelt id prints the list of valid ones.

## Record

Write: the date, the funder's name, its slug, the tenant id, the tools you
switched on, where the signed agreement is kept and the result of each check.
Do not write the administrator's address.

The command writes an audit event for the tenant ("tenant created"), one for
each tool and a configuration version for each, as the database role for the
operator. These are the evidence in the software. The signed agreement is the
operator's to keep.
