# Contributing to PixelGrant

Thanks for helping. PixelGrant is grants management software for foundations
and non-profits. Everything is open: there is no paid tier and no feature is
held back, so improvements reach every funder that uses it.

## Before you start

- Read the [V1 plan](docs/V1-PLAN.md) for what is in scope. Work outside V1
  goes to the backlog rather than the current sprint.
- For anything bigger than a small fix, open an issue first so we can agree
  the approach before you spend time on it.
- Report security problems through [SECURITY.md](SECURITY.md), never in a
  public issue.
- Never put real personal data in code, tests, fixtures, screenshots or
  issues. Use synthetic data.

## Pull requests

- Keep each pull request to one logical change. Small, focused changes are
  reviewed faster, especially in security-sensitive areas.
- `main` is protected. Changes reach it through a pull request with a green
  pipeline.
- Changes to authentication, row-level security, the audit log, migrations
  and data export always get a line-by-line review from a maintainer.

## Sign your commits (DCO)

Every commit needs a sign-off certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s
```

The sign-off confirms you wrote the change, or otherwise have the right to
submit it under the project licence, and that you have reviewed it.

## Definition of done

A change is ready to merge when:

- its acceptance criteria pass
- tests cover the new logic, with an end-to-end test for any change to a
  user journey
- permissions are checked on the server and covered by a test, including a
  cross-tenant denial test for any new data
- state changes and sensitive reads write audit events
- new fields are classified with a retention rule
- screens work with a keyboard and a screen reader, with no axe violations
- interface text follows the [content style guide](docs/CONTENT-STYLE.md)
- the pipeline is green: no new high or critical vulnerabilities, secrets or
  licence conflicts
- migrations are reversible, or the rollback is documented
- admin or self-hosting docs are updated where behaviour changed

## AI-assisted contributions

See [AI-assisted contributions](docs/AI-CONTRIBUTIONS.md). The same standards
apply to every change, however it was written.

## Licensing

By contributing you agree that your code is licensed under the
[GNU Affero General Public License v3.0](LICENSE) and your documentation
under [CC BY 4.0](LICENSE-docs).

## Development setup

The toolchain arrives in the first sprint. This section will then cover
installing dependencies, running the stack locally and running the checks.
