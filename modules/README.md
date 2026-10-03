# Modules

Each Fairfold tool is a module here, named by its code name. An organisation
can use any one tool on its own, or several together: a tenant switches each
tool on or off, and every tool runs on the same platform in `apps/` and
`packages/`.

One module is not a tool: `party`, the shared record of organisations,
people, relationships and consent. Every tool uses it, and it is always on.

A module owns its own database schema and reaches the platform and other
modules only through published contracts
([ADR 0016](../docs/adr/0016-modular-suite-and-shared-warehouse.md)).

Fairfold Grants is the first tool being built, with the shared record. The
other folders are placeholders for planned tools; the
[project README](../README.md#the-fairfold-suite) lists them all.
