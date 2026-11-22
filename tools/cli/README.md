# tps: the operator cli

`tps` installs, sets up and checks one Fairfold Grants deployment (one cell,
ADR 0012) from the command line. It changes nothing itself: every database
step runs the release's own commands, `packages/db/scripts/db.ts` and the
operator command, from the same tagged commit as the images
([ADR 0049](../../docs/adr/0049-operator-cli.md)).

No option takes a secret. Settings come from the environment, and secrets
from files in a folder only you can open. Each command passes secrets on as
file paths, never as an argument or an environment value, and hides every
secret it knows from what it prints.

The guides for self-hosters are in `docs/self-hosting/`. This file is the
command reference.

## Get and verify a release

Each cli release is a GitHub release tagged `cli-vX.Y.Z`, with the tarball,
its signature bundle and two SBOM attestations. Verify the tarball with
[cosign](https://docs.sigstore.dev/) before you unpack it:

```sh
version=0.1.0
repo=https://github.com/The-Pixel-Scientists/Fairfold
identity="$repo/.github/workflows/release.yml@refs/tags/cli-v$version"
issuer=https://token.actions.githubusercontent.com
for file in tar.gz tar.gz.sigstore.json spdx.sigstore.json cdx.sigstore.json; do
  curl --fail --location --remote-name "$repo/releases/download/cli-v$version/tps-cli-$version.$file"
done
cosign verify-blob "tps-cli-$version.tar.gz" --bundle "tps-cli-$version.tar.gz.sigstore.json" \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
cosign verify-blob-attestation "tps-cli-$version.tar.gz" --type spdxjson \
  --bundle "tps-cli-$version.spdx.sigstore.json" \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
cosign verify-blob-attestation "tps-cli-$version.tar.gz" --type cyclonedx \
  --bundle "tps-cli-$version.cdx.sigstore.json" \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer"
```

Go on only if every command prints `Verified OK`. Then install the locked
production dependencies with Node.js 26 and pnpm through Corepack:

```sh
tar -xzf "tps-cli-$version.tar.gz"
cd "tps-cli-$version"
corepack enable
pnpm install --frozen-lockfile --prod --filter "@pixel-scientists/cli..."
alias tps="node $PWD/tools/cli/src/main.ts"
```

From a checkout, run `node tools/cli/src/main.ts` in the same way.

The cli runs on Linux and macOS. On Windows it cannot check that only you
can open the secrets, so it stops: run it in WSL instead.

## Commands

Run `tps --help`, or `tps <command> --help`, for the same text. Each command
ends with exit code 0 when it succeeds, 1 when something needs fixing and 2
when its options are wrong.

### `tps install --secrets-dir <folder>`

Makes every secret the deployment needs, each a random 32-byte value in its
own file with mode 0600, in a folder with mode 0700 that is made if it is
missing. The folder must be outside the release folder. `install` never
replaces a secret: if any file is already there it stops and writes nothing.

| File                   | What it is                                             |
| ---------------------- | ------------------------------------------------------ |
| `postgres_password`    | The superuser of a database server you run             |
| `<role>_password`      | Each login role the roles script sets up               |
| `auth_secret`          | Seals sign-in data (`TPS_AUTH_SECRET_FILE`)            |
| `request_limit_key`    | Keys the request limits (`TPS_REQUEST_LIMIT_KEY_FILE`) |
| `subject_kek`          | Wraps each subject's data key (`TPS_SUBJECT_KEK_FILE`) |
| `compose.secrets.yaml` | Names each file above for Compose; holds no value      |

The login roles are `migrator`, `app_api`, `app_worker`, `app_auth`,
`app_queue` and `backup_reader`. Keep a copy of `auth_secret` and
`subject_kek` with your backups: data sealed with them cannot be read
without them. No administrator password is made: the first administrator
is invited by email by `tenant create`.

Pass `compose.secrets.yaml` after your deployment's Compose file, with
`--file`. Compose then mounts each file under `/run/secrets` in only the
containers that list it, and the services read them through their `*_FILE`
settings.

### `tps roles --secrets-dir <folder>`

Sets up the database, its roles and their passwords with the roles script
(`db.ts prepare`), and prints the roles script version.

- On a database server on this machine, it runs as the superuser named by
  `TPS_DB_SUPERUSER`, with the password in `postgres_password`.
- For a managed database, set `TPS_DB_ADMIN_MODE=managed` and
  `TPS_DB_SUPERUSER` to the provider's admin role. You are asked for that
  role's password, which is not shown as you type; pipe it in from a file
  to run without a terminal. The cli hands it to the roles script through
  a pipe, so it is never written to disk, even if the command is stopped
  part way. Every role is then checked, and any difference fails the
  command.

### `tps migrate --secrets-dir <folder>`

Checks the roles, then applies every pending migration as `migrator`
(`db.ts up`), naming each one.

### `tps tenant create --secrets-dir <folder> --slug <slug> --name <name> --admin-email <address> --modules <id,id>`

Creates a tenant with the tools you list switched on, and invites its first
administrator by email, through the operator command. No tool is on unless
you list it (ADR 0024), so `--modules` is required. It prints the tenant's
id and slug, never the invitation link. A bad slug, a taken slug or no
tools ends with a message and nothing written. It also needs
`TPS_CONSOLE_ORIGIN` and the `TPS_SMTP_` settings.

### `tps status --secrets-dir <folder> [--api <address>]`

Checks, without changing anything or reading any tenant's data: the
database connection and whether it uses TLS, the roles against this
release's roles script, pending migrations, whether the worker is connected
(`db.ts status`), and with `--api`, the API's `/health/ready`. Give the
API's own address, such as `http://127.0.0.1:3000`: the reverse proxy does
not pass health checks. It ends with exit code 1 if anything needs
attention.

## Settings

| Setting              | Used by                      | Notes                                            |
| -------------------- | ---------------------------- | ------------------------------------------------ |
| `TPS_DB_HOST`        | every database command       | The database server                              |
| `TPS_DB_PORT`        | every database command       |                                                  |
| `TPS_DB_NAME`        | every database command       | The deployment's database                        |
| `TPS_DB_TLS`         | every database command       | `verify-full` is required for a server elsewhere |
| `TPS_DB_TLS_CA_FILE` | every database command       | The server's certificate authority, if its own   |
| `TPS_DB_SUPERUSER`   | `roles`                      | The role the roles script runs as                |
| `TPS_DB_ADMIN_MODE`  | `roles`, `migrate`, `status` | `managed` for a managed database's admin role    |

The cli refuses to start if a setting holds a secret's value, such as
`TPS_DB_MIGRATOR_PASSWORD`: keep it in the secrets folder instead. Each
command it runs gets only your non-secret `TPS_` settings, `PATH`, and the
secret files it needs.

## Not in v0

- Helm inputs: `install` writes Compose inputs only, until the Helm chart
  exists.
- Storage keys: they come from your S3 provider.
- Backup, restore, moving a tenant, upgrades and secret rotation.
