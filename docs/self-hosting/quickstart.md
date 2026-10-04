# Quickstart: run Fairfold Grants on your computer

This page takes you from a fresh clone to a running stack: a database, the
API, the staff console and the applicant portal, all in containers on your
own machine. Most of the time is the first build, which can take five
minutes or more.

> **Fairfold Grants is pre-release software. Do not put live personal data in this
> stack.** Use it to try the platform and to check that your hosting set-up
> works. It has no sign-in yet, no backups, no encryption in transit, and it
> has not had a penetration test or any security certification. See
> [What this stack does and does not protect](#what-this-stack-does-and-does-not-protect).

## What you get

`pnpm stack` builds and runs five containers:

| Container | What it is |
| --- | --- |
| `postgres` | PostgreSQL 16, with its data in a Docker volume |
| `migrate` | A one-off job that creates the database roles and applies every migration, then exits |
| `api` | The Fairfold Grants API |
| `console` | The staff console |
| `portal` | The applicant portal |

The console and the portal are placeholders today. The console shows an empty
list of programmes, and the portal says no grants are open. There is no
sample data, no sign-in, and no way yet to set up a programme. The stack has
no mail, file storage, virus scanner or background worker either. `pnpm dev`,
the command for contributors, starts a mail catcher, file storage and a
virus scanner next to the database, and runs the apps from source.

## What you need

| You need | Version | Why |
| --- | --- | --- |
| Git | Any recent version | To clone the code |
| Node.js | 24.21.0 (named in `.node-version`). Any 24 release from 24.16.0 works | `pnpm stack` is a Node.js script that runs on your machine |
| pnpm | 12.5.1, which Corepack fetches for you | Runs the commands. It also installs the project's dependencies first, if they are missing |
| Docker with Compose v2 | We tested Docker 29.8.0 with Compose 5.5.1. On Linux, use Docker Engine 28 or later | Builds and runs the containers |
| Three free ports | On `127.0.0.1`, between 41000 and 48999 | The script picks them for you |
| Disk and network | A few gigabytes of disk, and internet access for the first build | The build downloads base images and packages |

Check your tools:

```sh
git --version
node --version
docker --version
docker compose version
```

We ran every command on this page from Git Bash on Windows 11. We have not
yet run them on Linux or macOS.

## Get the code

```sh
git clone https://github.com/The-Pixel-Scientists/Fairfold.git
cd Fairfold
corepack enable
```

`corepack enable` makes the `pnpm` command available at the version the
project asks for. If it fails with a permissions error, run it in an
administrator terminal, or install pnpm 12.5.1 another way.

You do not need to run `pnpm install` yourself. `pnpm stack` installs the
dependencies on your machine before it starts, and the images install their
own inside Docker.

## Settings

`pnpm stack` needs no settings file. It makes its own passwords (see
[Where the secrets are kept](#where-the-secrets-are-kept)) and does not read
`.env`.

Only the development commands, such as `pnpm dev` and `pnpm db:migrate`, read
`.env`. If you plan to use them, copy the template:

```sh
cp .env.example .env
```

`.env` is ignored by Git, so your changes never reach a commit. A value in
your shell wins over one in `.env`, and a value in `.env` wins over the
built-in development value. The development commands refuse to run against a
database that is not on your machine.

## Start the stack

```sh
pnpm stack
```

The first start takes a few minutes. It installs dependencies, builds the
images, starts PostgreSQL, runs the migrations, then starts the API, console
and portal. It returns when every container reports healthy. On a shared
machine with a slow connection, the first start took 5 minutes 20 seconds.
Later starts took 35 seconds, because Docker reuses what it built.

A successful start ends like this:

```
http://127.0.0.1:48646/health/ready answered 200: {"status":"ok","checks":{"database":"ok"}}
Console: http://console.localhost:48647
Portal:  http://portal.localhost:48648
Stop it with: pnpm stack down
```

Your port numbers will differ. The script works them out from the name of the
folder you cloned into, so two clones on one machine never use the same ports,
containers or database.

You may also see `This project requires Node.js 24.21.0`. It is a warning, not
an error: the stack runs on any 24 release from 24.16.0. Install 24.21.0 to
clear it.

## Check that it works

Every address below uses the ports the start-up printed. Replace `48646`,
`48647` and `48648` with yours.

1. List the containers:

   ```sh
   pnpm stack ps
   ```

   `postgres`, `api`, `console` and `portal` should say `(healthy)`. The
   `migrate` job has finished and exited, so it only shows with
   `pnpm stack ps --all`.

2. Ask the API whether it is running, then whether it can reach the database:

   ```sh
   curl http://127.0.0.1:48646/health
   curl http://127.0.0.1:48646/health/ready
   ```

   You should see `{"status":"ok"}` and
   `{"status":"ok","checks":{"database":"ok"}}`. If the database is down, the
   second address answers `503`. It never says why; the reason is in the API's
   log.

3. Open the console at `http://console.localhost:48647`. It shows a
   **Programmes** page that says "No programmes yet".

4. Open the portal at `http://portal.localhost:48648`. It shows **Apply for a
   grant** and "No grants are open yet".

Your browser sends `*.localhost` names to your own machine, so you do not need
to change a hosts file.

To read the API's log, run `pnpm stack logs api`. It writes one JSON object per
line. Every two seconds you will also see Docker's own health check asking
`/health/ready`.

## Stop the stack

```sh
pnpm stack down
```

This stops and removes the containers. It keeps the database and the secrets,
so the next `pnpm stack` carries on where you left off.

To delete everything this stack made, including its database and its secrets,
and the images it built:

```sh
pnpm stack down --volumes --rmi local
```

This cannot be undone. Use it when you want a clean start, or before you
delete the folder you cloned into.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `The stack's database was made with a superuser password that is no longer in ...` | The secrets folder was deleted but the database was not. Run `pnpm stack down --volumes` to delete the database too, then `pnpm stack` |
| Docker says a port is already allocated | Stop whatever uses it, or clone into a folder with another name, which gives you other ports |
| `pnpm stack` stops at once and prints nothing | Docker is not installed, or is not on your path. Run `docker compose version` to check |
| Docker says it cannot connect to its daemon | Start Docker, then run `pnpm stack` again |
| A container is not healthy | Run `pnpm stack logs <name>`, for example `pnpm stack logs api`, and read the last lines |
| The build fails while downloading | Check your internet connection and run `pnpm stack` again. Docker keeps the layers it already built |

Any other Compose command works the same way: `pnpm stack <command>` passes it
to Docker Compose for this clone's project.

## Where the secrets are kept

On the first start, `pnpm stack` makes six passwords with a cryptographically
secure random generator: one for the PostgreSQL superuser, one for the
migration role and one for each of the four application roles. It writes each
to its own file in `~/.tps/stack/tps_stack_<folder name>/`.
Nothing is written into the clone, so none of them can reach a commit.

On Linux and macOS only you can read those files. On Windows, Node.js cannot
set that, so they have the permissions of your user folder.

Compose copies each password only into the containers that need it. The
console and portal get none. The API gets the password of its own role, and
PostgreSQL gets the superuser's. Only the `migrate` job gets the migration
role's password.

## What this stack does and does not protect

What the code does for you:

- The passwords are random, and nothing ships with a default.
- The API connects to the database as a role that is not a superuser, cannot
  create roles or databases, and cannot bypass row-level security. The
  migration role is used only by the `migrate` job.
- The API refuses development passwords, which is why it will not start with
  the ones `pnpm dev` uses.
- PostgreSQL sits on an internal Docker network with no route out and no
  published port.
- The API, console and portal publish ports on `127.0.0.1` only, so another
  computer cannot reach them.
- No container can gain privileges, and the console and portal containers have
  a read-only file system.
- The console and portal send a Content Security Policy and the other security
  headers set out in ADR 0006.

What it does not do, and what you would have to provide for a real
installation:

- **No encryption in transit.** The stack serves plain HTTP. A real
  installation needs a reverse proxy with a TLS certificate in front of it.
- **No backups.** The data lives in one Docker volume,
  `tps_stack_<folder name>_postgres-data`. Back up that volume and the
  secrets folder together; without the passwords the backup cannot be used.
- **No sign-in, mail, file storage or virus scanning yet.** They are not built
  yet.
- **No upgrade path yet.** There are no release versions. Treat each pull of
  the code as a new install.
- **No hardening guide yet.** Host security, updates and monitoring are yours.
  The hardening guide comes in a later sprint.

Do not open these ports to a network, and do not point the stack at real
people's data.

## Where to go next

- [Architecture rules](../ARCHITECTURE.md) explain how the platform is built.
- [ADR 0005](../adr/0005-dev-topology.md) explains why `pnpm dev` and
  `pnpm stack` both exist, and how the stack's secrets and networks work.
- [Contributing](../../CONTRIBUTING.md) covers the rules for changing the code.
