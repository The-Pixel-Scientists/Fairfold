# Quickstart: run Fairfold Grants on your computer

This page takes you from a fresh clone to a running stack with demo data: a
database, the API, the staff console, the applicant portal, a mail catcher,
file storage and a virus scanner, all in containers on your own machine. Then
it shows you how to sign in for the first time. Most of the time is the first
build, which can take five minutes or more.

> **Fairfold Grants is pre-release software. Do not put live personal data in
> this stack.** Use it to try the platform and to check that your hosting
> set-up works. It has no backups, no encryption in transit and no background
> worker, and it has not had a penetration test or any security
> certification. See
> [What this stack does and does not protect](#what-this-stack-does-and-does-not-protect).

## What you get

`pnpm stack` builds and runs these containers:

| Container | What it is |
| --- | --- |
| `postgres` | PostgreSQL 16, with its data in a Docker volume |
| `migrate` | A one-off job that creates the database roles and applies every migration, then exits |
| `api` | The Fairfold Grants API |
| `console` | The staff console |
| `portal` | The applicant portal |
| `mailpit` | Catches every email the API sends, so no email leaves your machine. Read them in a browser |
| `seaweedfs` | S3-compatible file storage, for the files applicants upload |
| `storage-bucket` | A one-off job that creates the storage bucket, then exits |
| `clamav` | The virus scanner. The API checks every upload with it before storing the file |

The stack starts empty. `pnpm stack seed` fills it with two synthetic funders
and their staff (see [Fill the stack with demo data](#fill-the-stack-with-demo-data)).
`pnpm dev`, the command for contributors, runs the services next to the
database and the apps from source with hot reload.

**ClamAV needs more than 1 GB of memory and about a minute to load its
signatures.** The API waits for it, so the first start is slower. While
ClamAV is down, uploads stop: the applicant is told the file could not be
checked, and nothing is stored. Everything else keeps working. If Docker
gives your containers too little memory, ClamAV never becomes healthy: raise its
memory limit first.

## What you need

| You need | Version | Why |
| --- | --- | --- |
| Git | Any recent version | To clone the code |
| Node.js | 24.21.0 (named in `.node-version`). Any 24 release from 24.16.0 works | `pnpm stack` is a Node.js script that runs on your machine |
| pnpm | 12.5.1, which Corepack fetches for you | Runs the commands. It also installs the project's dependencies first, if they are missing |
| Docker with Compose v2 | We tested Docker 29.8.0 with Compose 5.5.1. On Linux, use Docker Engine 28 or later | Builds and runs the containers |
| Memory for Docker | Enough for ClamAV, which needs over 1 GB, beside everything else | The virus scanner holds its signatures in memory |
| Four free ports | On `127.0.0.1`, between 41000 and 48999 | The script picks them for you |
| Disk and network | A few gigabytes of disk, and internet access for the first build | The build downloads base images and packages |
| An authenticator app | Any app that makes 6-digit codes, on your phone | Staff accounts need a code each time they sign in |

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

`pnpm stack` needs no settings file. It makes its own passwords and keys (see
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
images, starts PostgreSQL, runs the migrations, starts the file storage and
ClamAV, then starts the API, console and portal. It returns when every
container reports healthy. Later starts are faster, because Docker reuses what
it built, but ClamAV still takes about a minute.

A successful start ends like this:

```
http://127.0.0.1:46506/health/ready answered 200: {"status":"ok","checks":{"database":"ok"}}
Console: http://console.localhost:46507
Portal:  http://portal.localhost:46508
Mailpit: http://127.0.0.1:46509
Fill it with synthetic data with: pnpm stack seed
Stop it with: pnpm stack down
```

Your port numbers will differ. The script works them out from the name of the
folder you cloned into, so two clones on one machine never use the same ports,
containers or database. `pnpm dev:names` prints them again at any time.

You may also see `This project requires Node.js 24.21.0`. It is a warning, not
an error: the stack runs on any 24 release from 24.16.0. Install 24.21.0 to
clear it.

## Fill the stack with demo data

```sh
pnpm stack seed base
```

The seed writes synthetic funders, staff and (in the larger scenarios)
applications into the stack's database. It reaches the database through a
short-lived container that only your machine can reach, and removes the
container when it finishes. Name one scenario:

| Scenario | What it adds |
| --- | --- |
| `base` | Two funders, **Northfield Community Trust** (`/northfield`) and **Eastmoor Foundation** (`/eastmoor`). Each has an administrator, a programme manager and two reviewers. Nothing else: you set up the programme yourself. Eastmoor has its own brand colour, so the two look different. This is the one the [demo script](../demo/mvp1-demo.md) starts from |
| `configured` | `base`, plus Northfield's Community Spaces Fund, open, with one round (12 October to 2 November 2026), its three stages, a rubric, a published application form and the outcome emails. This is the default if you name none |
| `applications` | `configured`, with the round moved to 7 September to 5 October 2026 and five submitted applications and one withdrawn, across its three stages, with reviews partly done and two decisions recorded but not released |

The seed refuses to run on a database that already has funders. To start
again, delete the stack's data first (see [Stop the stack](#stop-the-stack)).

When it finishes, the seed lists every account, for example
`sunita.rao@northfield.example  tenant_admin`, and names the file that holds
the password. All seeded accounts share one password. The seed never prints
it. It is a random password that the stack made for this clone, kept in
`~/.tps/stack/<project>/TPS_STACK_SEED_PASSWORD`, where `<project>` is the
`stackProject` that `pnpm dev:names` prints. Open the file to read it.

Seeded staff have no authenticator app set up. They set one up the first time
they sign in.

## Sign in for the first time

1. Open the console at the address the start-up printed, with your funder's
   name on the end: `http://console.localhost:46507/northfield`.
2. Enter `sunita.rao@northfield.example` and the seed password, then choose
   **Sign in**.
3. The next page is **Set up your authenticator app**. It shows a **Set-up
   key** in groups of four letters and digits. In your authenticator app, add
   an account and type in that key. (There is no QR code yet.)
4. Enter the 6-digit code the app shows under **Code from your app**, then
   choose **Finish set-up**. You are in the console.

Next time you sign in, the page asks for **Enter your code**. Each code works
once, so if you have just used one, wait for the app to show the next. Each
staff account has its own key, so add one app entry for each account you use.

If you would rather not keep the seed password, choose **Forgot your password?** on
the sign-in page. The email with the link goes to Mailpit.

### Read the emails

Every email the stack sends (reset links, sign-up links, invitations and
decision emails) goes to Mailpit. Open the `Mailpit:` address the start-up
printed, for example `http://127.0.0.1:46509`, and open the message. Mailpit
keeps its messages only until the stack is stopped.

## Check that it works

Every address below uses the ports the start-up printed. Replace `46506`,
`46507`, `46508` and `46509` with yours.

1. List the containers:

   ```sh
   pnpm stack ps
   ```

   `postgres`, `api`, `console`, `portal`, `mailpit`, `seaweedfs` and `clamav`
   should say `(healthy)` or `Up`. The `migrate` and `storage-bucket` jobs
   have finished and exited, so they only show with `pnpm stack ps --all`.

2. Ask the API whether it is running, then whether it can reach the database:

   ```sh
   curl http://127.0.0.1:46506/health
   curl http://127.0.0.1:46506/health/ready
   ```

   You should see `{"status":"ok"}` and
   `{"status":"ok","checks":{"database":"ok"}}`. If the database is down, the
   second address answers `503`. It never says why; the reason is in the API's
   log.

3. Open the portal at `http://portal.localhost:46508/northfield`. It shows the
   **Apply for a grant** page with **Create an account** and **Sign in**. On a
   stack seeded with `base`, no grant is open yet.

4. Open the console, sign in as in the section above, and check that the
   main navigation lists **Settings**, **Team**, **Data** and **Audit log**.

Your browser sends `*.localhost` names to your own machine, so you do not need
to change a hosts file.

To read the API's log, run `pnpm stack logs api`. It writes one JSON object per
line. Every two seconds you will also see Docker's own health check asking
`/health/ready`.

## Make a funder of your own

`pnpm tenant:create` makes a funder and emails its first administrator an
invitation:

```sh
pnpm tenant:create --slug harbour-trust --name "Harbour Trust" --admin-email you@example.org
```

It prints the funder's id and slug and never a link or a token. The slug is 3
to 40 lower case letters, numbers and single hyphens, starting with a letter.
A slug that is taken, or a bad slug, name or address, ends with a plain message
and writes nothing.

**It works on the `pnpm dev` database, not on the stack's.** The command reads
the same development settings as `pnpm dev` (`pnpm db:migrate` first, and the
development services running, including the mail catcher on port 58025). The
stack's database sits on a network that only the containers can reach, and no
operator command for it exists yet. For a funder in the stack today, use
`pnpm stack seed`.

If the mail server is down, the command still makes the funder, then says "The
first administrator has not been invited." Start the mail catcher, and invite
the administrator again from a seeded administrator's **Team** page.

## Stop the stack

```sh
pnpm stack down
```

This stops and removes the containers. It keeps the database, the stored files
and the secrets, so the next `pnpm stack` carries on where you left off. Mailpit
keeps nothing, so its messages are gone.

To delete everything this stack made, including its database, its files, its
secrets and the images it built:

```sh
pnpm stack down --volumes --rmi local
```

This cannot be undone. Use it when you want a clean start, or before you
delete the folder you cloned into. For a clean start with demo data again:

```sh
pnpm stack down --volumes
pnpm stack
pnpm stack seed base
```

The deletion makes new passwords and keys, so remove the old accounts from your
authenticator app: the new ones have new set-up keys.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `The stack's database was made with a superuser password that is no longer in ...` | The secrets folder was deleted but the database was not. Run `pnpm stack down --volumes` to delete the database too, then `pnpm stack` |
| Docker says a port is already allocated | Stop whatever uses it, or clone into a folder with another name, which gives you other ports |
| `pnpm stack` stops at once and prints nothing | Docker is not installed, or is not on your path. Run `docker compose version` to check |
| Docker says it cannot connect to its daemon | Start Docker, then run `pnpm stack` again |
| `pnpm stack` waits a long time at `clamav` | ClamAV is loading its signatures, which takes about a minute and over 1 GB of memory. Give Docker more memory if it never becomes healthy |
| An upload says "The file could not be checked" | ClamAV is down or still starting, or the file is encrypted or damaged. Run `pnpm stack ps` and `pnpm stack logs clamav` |
| An upload says "We are checking other files" | The API is scanning as many files as it allows at once. Wait a minute and try again |
| A container is not healthy | Run `pnpm stack logs <name>`, for example `pnpm stack logs api`, and read the last lines |
| The build fails while downloading | Check your internet connection and run `pnpm stack` again. Docker keeps the layers it already built |
| `Refusing to seed ...: it already has tenants` | The seed only fills an empty database. Delete the data with `pnpm stack down --volumes`, then run `pnpm stack` and `pnpm stack seed base` again |
| The sign-in page does not accept your code | Each code works once, and your phone's clock must be right. Wait for the next code |

Any other Compose command works the same way: `pnpm stack <command>` passes it
to Docker Compose for this clone's project.

## Where the secrets are kept

On the first start, `pnpm stack` makes its secrets with a cryptographically
secure random generator: six database passwords (the PostgreSQL superuser, the
migration role and the four application roles), the secret the API uses for
sign-in, three keys for the file storage (admin, write and read), and four
keys that SeaweedFS's own servers sign their requests with. It writes each to
its own file in `~/.tps/stack/tps_stack_<folder name>/`. The first `pnpm stack
seed` adds the seed password to the same folder. Nothing is written into the
clone, so none of them can reach a commit.

On Linux and macOS only you can read those files. On Windows, Node.js cannot
set that, so they have the permissions of your user folder.

Compose copies each secret only into the containers that need it. The console
and portal get none. The API gets the password of its own roles, the sign-in
secret and the storage keys for writing and reading only. PostgreSQL gets the
superuser's. Only the `migrate` job gets the migration role's password, and
only the bucket job gets the storage admin key.

### Settings the API reads for files

Everything above is already set for you in the stack. If you run the API some
other way, these settings are all required, and the API refuses to start
without them. Each secret setting also has a `_FILE` form that names a file
holding the value.

| Setting | What it is |
| --- | --- |
| `TPS_STORAGE_ENDPOINT` | The storage address, with a host and port only, for example `http://seaweedfs:8333` |
| `TPS_STORAGE_REGION` | The storage region name, for example `us-east-1` |
| `TPS_STORAGE_BUCKET` | The bucket that holds the files |
| `TPS_STORAGE_WRITE_ACCESS_KEY_ID`, `TPS_STORAGE_WRITE_SECRET_ACCESS_KEY` | The key that may only write files under `clean/` |
| `TPS_STORAGE_READ_ACCESS_KEY_ID`, `TPS_STORAGE_READ_SECRET_ACCESS_KEY` | The key that may only read files under `clean/` |
| `TPS_CLAMD_HOST`, `TPS_CLAMD_PORT` | Where the ClamAV daemon listens |
| `TPS_CLAMD_TIMEOUT_MS` | How long the API waits for a scan, from 1000 to 25000. The stack uses 25000, 5 seconds after ClamAV's own 20-second limit |
| `TPS_FILES_MAX_STORES` | How many uploads the API scans and stores at once, from 1 to 9. The stack uses 4 |

## What this stack does and does not protect

What the code does for you:

- The passwords and keys are random, and nothing ships with a default.
- People sign in with a password, kept hashed with Argon2id. Staff and
  reviewers also need a 6-digit code from an authenticator app, and a code
  works once. Releasing decisions asks the manager to confirm it is them again
  first.
- The API connects to the database as a role that is not a superuser, cannot
  create roles or databases, and cannot bypass row-level security. Row-level
  security keeps each funder's rows apart. The migration role is used only by
  the `migrate` job.
- The API refuses development passwords, which is why it will not start with
  the ones `pnpm dev` uses.
- Every upload is checked for type and size, then scanned by ClamAV, and only
  a clean file is stored. The storage and the scanner sit on networks of
  their own with no route out, and ClamAV cannot reach the storage.
- PostgreSQL sits on an internal Docker network with no route out and no
  published port.
- The API, console, portal and Mailpit publish ports on `127.0.0.1` only, so
  another computer cannot reach them.
- No container can gain privileges, and the console and portal containers have
  a read-only file system.
- The console and portal send a Content Security Policy and the other security
  headers set out in ADR 0006.
- The audit log records state changes, decisions, permission changes and file
  downloads.

What it does not do, and what you would have to provide for a real
installation:

- **No encryption in transit.** The stack serves plain HTTP. A real
  installation needs a reverse proxy with a TLS certificate in front of it.
  The migrate job and the database scripts do not use TLS to reach the
  database either, so do not point any of them at a database server off the
  stack's own private network.
- **No backups.** The data lives in two Docker volumes,
  `tps_stack_<folder name>_postgres-data` and
  `tps_stack_<folder name>_seaweedfs-data`. Back up both volumes and the
  secrets folder together; without the passwords the backup cannot be used.
- **No background worker.** Emails to applicants go out from the API, and
  reminders do not exist yet.
- **No upload limits at the edge.** There is no reverse proxy, no rate limit
  on uploads and no rescan of stored files yet.
- **No upgrade path yet.** There are no release versions. Treat each pull of
  the code as a new install.
- **No hardening guide yet.** Host security, updates and monitoring are yours.
  The hardening guide comes in a later sprint.
- **No sign-in with a passkey or a single sign-on provider, and no backup
  codes.** Lose your authenticator app and you lose access to that account.

Do not open these ports to a network, and do not point the stack at real
people's data.

## Where to go next

- [The demo script](../demo/mvp1-demo.md) takes you through a whole funding
  round on the stack, step by step.
- [Load the warehouse snapshot](warehouse-snapshot.md) shows how to take your
  data out and ask your own questions.
- [Write a funder stylesheet](funder-stylesheet.md) is for a funder's designer.
- [What the first release leaves out](../demo/mvp1-known-gaps.md).
- [Architecture rules](../ARCHITECTURE.md) explain how the platform is built.
- [ADR 0005](../adr/0005-dev-topology.md) explains why `pnpm dev` and
  `pnpm stack` both exist, and how the stack's secrets and networks work.
- [Contributing](../../CONTRIBUTING.md) covers the rules for changing the code.
