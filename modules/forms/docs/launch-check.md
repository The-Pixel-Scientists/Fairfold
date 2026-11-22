# Launch check

Before a tool launches, the platform asks whether it needs a full module gate
or the lighter check. This page sets out the lighter check, how forms meets
it, and the one question that is still open.

## What the lighter check is

A tool that adds no new class of data or money needs three things:

1. **The definition of done.** Acceptance criteria pass; tests cover the new
   logic; the server checks permissions and every new table has a cross-tenant
   denial test; state changes and sensitive reads are audited; every new
   field is classified with a retention rule; interface text follows the
   content style; no new high or critical vulnerability, secret or licence
   conflict; migrations can be reversed or have a documented rollback; the
   docs match what the software does.
2. **An accessibility check of the key journeys.** Keyboard and screen-reader
   use, no automated accessibility violations, WCAG 2.2 AA, at 320 pixels
   wide and 200% zoom.
3. **A design partner.** A real funder uses the tool and says it works for
   them.

## How forms meets each part

| Part                | What the code provides                                                                                                          | What is left                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition of done  | Contracts with tests, per-column classification, audit actions, row-level security on every forms table, a reversible migration | The API does not register the forms routes yet; embedding, the warehouse contract and automatic deletion of expired responses are not built (see [Forms](index.md)) |
| Accessibility check | End-to-end accessibility specs for the console screens and the public pages are written                                         | They run in the pull request pipeline; a person must also walk the key journeys with a screen reader                                                                |
| Design partner      | Not something code provides                                                                                                     | The operator names a funder                                                                                                                                         |

## The open question

Forms is named in the roadmap as a tool that adds no new class of data, which
would put it on the lighter check. Anonymous public submission is different in
four ways:

- an unauthenticated write path, through one approved database function;
- a respondent reference, kept as a keyed hash;
- a new public attack surface, with a browser check, rate limits and a spam
  process;
- answers from people who are often beneficiaries, with no account.

Arguments for the lighter check: the data classes are the ones the platform
already holds; the write path is small, narrow and tested; the January
penetration test and the launch gate pack cover part of the new surface.

Arguments for a full gate: the surface is new and public; a bug could let
anyone write to the database or fill it with spam; the platform has not yet
had an outside test of it.

A full module gate would add:

| Item                                                             | Status in the code                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Data protection impact assessment addendum                       | Not in the code; written and signed off by the operator                     |
| Threat model                                                     | Not in the code; written by the operator                                    |
| Penetration test of the public surface, every high finding fixed | Planned for January; not in the code                                        |
| Audit of the controls                                            | Not in the code                                                             |
| Complete field classification                                    | In the code, for every forms column (`packages/db/classification/forms.ts`) |
| Runbooks                                                         | Not written for forms yet                                                   |

**Decision for the project lead: the lighter check or a full module gate for
forms.**

**Decision:** to be recorded here. The sections above read correctly either
way; change this line to the decision and its date.

## What the code provides, and what the operator provides

The code provides tenant isolation, an audit trail of publishes, spam marking
and response reads, per-column classification, and a write path that sets no
tenant and takes no session. The operator provides the keys, the hosting, the
penetration test, the impact assessment, the retention of backups, and the
deletion of expired responses until the platform does it.

Nothing here claims that forms is compliant with any standard. It lists the
controls and who supplies each.
