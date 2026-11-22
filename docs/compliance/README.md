# Self-hoster evidence pack

This pack helps a funder that runs its own deployment show an assessor, an
auditor or a procurement team what the software does for information
security, and what the funder must do itself.

**Edition:** first edition, planned for 9 December 2026.
**Checked against the code on:** 19 November 2026.
**Software release it describes:** not yet available. No release has been
tagged, so the pack describes the code on the main branch. The second edition
will name a release.

## Who this is for

- A grants manager or data protection lead who is filling in a security
  questionnaire or a data protection impact assessment (DPIA).
- An IT person who runs the platform and must answer "how do you know?" for
  each control.
- An assessor who wants to follow each claim to a file, a test or a runbook.

## What the pack says, and what it does not

The software makes controls possible. The operator has to prove them.

- "Provided" means the code does it, and the evidence column shows where.
- "Supported" means the code or a runbook helps, but the operator must
  configure it or run it.
- "Operator only" means no software can do it. Policies, staff training,
  contracts, premises, devices and the management system are in this group.

Nothing here is a certification. The project does not hold ISO 27001
certification or a Cyber Essentials Plus certificate, and no audit has
passed. Those apply to an organisation, and your organisation has to obtain
them. The pack gives you the technical evidence to bring to that work.

Where the software does not do something yet, the pack says "not yet
available".

Some decision records (ADRs) are still marked "proposed". The code and tests
are the evidence. Where a page relies on a proposed ADR, it says so.

## Pages

- [Control mapping](control-mapping.md): ISO 27001:2022 Annex A and Cyber
  Essentials Plus, control by control.
- [DPIA template](dpia-template.md): a data protection impact assessment to
  complete, with the data flows filled in from the records of processing.
- [Accessibility results](accessibility-results.md): what the automated and
  manual checks cover.
- [SBOM and licences](sbom-and-licences.md): how to download and verify the
  software bill of materials and signatures, and the licence inventory.
- [Recorded debt](recorded-debt.md): the definition-of-done items still open.

Module pages, one for each tool:

- [Platform](modules/platform.md)
- [Party](modules/party.md)
- [Grants](modules/grants.md)
- [CRM](modules/crm.md)
- [Due diligence](modules/assure.md)
- [Forms](modules/forms.md)
- [Data protection](modules/privacy.md)
- [Reporting](modules/insight.md)

Related guides in this repository:

- [Self-hosting quickstart](../self-hosting/quickstart.md)
- Hardening guide: not yet available. The pack will link it when it merges.
- [Runbooks](../runbooks/README.md)
- [Administrator guide](../admin/README.md)
- [Accessibility documents](../accessibility/README.md)
- [Architecture rules](../ARCHITECTURE.md)
- [Security policy](../../SECURITY.md)

## No feature is gated

Self-hosters get everything the managed service gets, and the same pack.

## Licence

This pack is licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](../../LICENSE-docs).
You may copy and adapt it, including for your own evidence pack. When you
do, use this attribution line:

> Based on the self-hoster evidence pack by The Pixel Scientists, licensed
> under CC BY 4.0. Changes were made.

The software is licensed under AGPL-3.0-or-later. See
[SBOM and licences](sbom-and-licences.md).

## Using the pack

1. Read the [control mapping](control-mapping.md) and mark which controls
   you meet and how.
2. Complete the [DPIA template](dpia-template.md) for your deployment.
3. Keep the evidence your own way: logs, screenshots, signed records. Linking
   to this pack is not evidence that your deployment works that way.
4. Check each link to a test or file against the version you run.
