# Fairfold API

The Fastify server behind the console and the portal. Routes are registered
with Zod schemas (`fastify-type-provider-zod`), which validate every request,
encode every response and produce the OpenAPI document
([ADR 0004](../../docs/adr/0004-api-contract.md)).

```sh
node src/main.ts                    # start the API
pnpm --filter @pixel-scientists/api dev   # start it with reload
```

## Settings

The API reads its settings from the environment only and checks them before it
opens a port or a database connection. If one is missing or not valid, it
prints every problem, naming each variable, and exits with status 1. There are
no default credentials or addresses.

In a deployment, give each secret as a file: set the `_FILE` variable to the
path of a mounted Compose or Kubernetes secret, and leave the plain variable
unset. The plain variable is for development and tests. Setting both is an error.

| Variable                                | Required                                           | Meaning                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TPS_API_HOST`                          | Yes, except in development                         | Address to listen on, such as `0.0.0.0` in a container                                                                                                                                                                                 |
| `TPS_API_PORT`                          | Yes                                                | Port to listen on, 1 to 65535                                                                                                                                                                                                          |
| `TPS_DB_HOST`                           | Yes                                                | PostgreSQL host                                                                                                                                                                                                                        |
| `TPS_DB_PORT`                           | Yes                                                | PostgreSQL port                                                                                                                                                                                                                        |
| `TPS_DB_NAME`                           | Yes                                                | Database name: lower-case letters, digits and underscores, at most 63 characters, not one of PostgreSQL's own databases                                                                                                                |
| `TPS_DB_TLS`                            | Yes, unless the database server is on this machine | `verify-full` encrypts the connection and checks the server's certificate and host name. `disable` sends everything in clear, and belongs only on a private network such as Compose's                                                  |
| `TPS_DB_TLS_CA` or `TPS_DB_TLS_CA_FILE` | No                                                 | Certificate authority of the database server, in PEM, when Node.js does not already trust it. Only with `verify-full`                                                                                                                  |
| `TPS_DB_APP_API_PASSWORD_FILE`          | Yes in a deployment                                | Path of the file that holds the password of the `app_api` role, at least 16 characters                                                                                                                                                 |
| `TPS_DB_APP_API_PASSWORD`               | Instead of the file, in development                | The password itself                                                                                                                                                                                                                    |
| `TPS_SMTP_HOST`                         | Yes                                                | Mail server host. The API does not send mail yet, but it needs the mail settings to start                                                                                                                                              |
| `TPS_SMTP_PORT`                         | Yes                                                | Mail server port                                                                                                                                                                                                                       |
| `TPS_SMTP_TLS`                          | Yes                                                | `starttls`, `tls` or `none`, which works only for a mail server at a loopback IP address (127.0.0.0/8 or `::1`), and with a login only when `TPS_DEV=1`. The relay must share the API's network namespace, as the stack's Mailpit does |
| `TPS_SMTP_USER`                         | With the password                                  | Mail server login. Set it together with the password, or leave both out                                                                                                                                                                |
| `TPS_SMTP_PASSWORD` or `_FILE`          | With the user                                      | Mail server password, or the path of the file that holds it                                                                                                                                                                            |
| `TPS_SMTP_FROM`                         | Yes                                                | The address emails are sent from                                                                                                                                                                                                       |
| `TPS_LOG_LEVEL`                         | No                                                 | `fatal`, `error`, `warn`, `info` (the default), `debug`, `trace` or `silent`                                                                                                                                                           |
| `TPS_DEV`                               | No                                                 | `1` for development: the listener binds to `127.0.0.1`, and the fixed development passwords are accepted, but only against a database server on this machine                                                                           |

The file service (`src/platform/files`, ADR 0047) needs these as well. All are
required, with no fallback; a secret may be given as `_FILE` like the others.

| Variable                                                                 | Meaning                                                                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `TPS_STORAGE_ENDPOINT`                                                   | Address of the S3-compatible store: `http` or `https`, host and port only. Every storage call goes there and nowhere else               |
| `TPS_STORAGE_REGION`, `TPS_STORAGE_BUCKET`                               | Signing region and the deployment's bucket (path-style)                                                                                 |
| `TPS_STORAGE_WRITE_ACCESS_KEY_ID`, `TPS_STORAGE_WRITE_SECRET_ACCESS_KEY` | The key that writes `clean/`. Used only to put an object                                                                                |
| `TPS_STORAGE_READ_ACCESS_KEY_ID`, `TPS_STORAGE_READ_SECRET_ACCESS_KEY`   | The key that reads `clean/`. Used only to get an object                                                                                 |
| `TPS_CLAMD_HOST`, `TPS_CLAMD_PORT`                                       | The scanner                                                                                                                             |
| `TPS_CLAMD_TIMEOUT_MS`                                                   | How long a scan may take, 1000 to 25000. clamd stops at 20 seconds                                                                      |
| `TPS_FILES_MAX_STORES`                                                   | Uploads scanned at once in this process, 1 to 9 (the database pool has 10 connections). Another upload gets a 503 with `Retry-After: 5` |

## Files

A handler stores and sends files only through `context.files`, which is bound
to the request's transaction and acting member:

- `store({ name, bytes, allowedTypes, maxBytes })` checks size, name, type and
  extension, inserts a pending `app.file` row, scans with clamd, and writes
  `clean/<tenant id>/<file id>` only for a clean file. It returns `{ file }` or
  `{ refusal }` and audits `platform.file.uploaded` or `platform.file.refused`.
  A handler that answers a refusal with an error rolls the row and event back.
- `send(fileId, { audit })` reads the row under row-level security and streams
  the object with ADR 0047's headers. A missing, unclean or other tenant's file
  is the usual 404. `audit` writes `platform.file.downloaded`.

A route with a raw upload body (`{ raw: ['application/octet-stream'], maxBytes }`)
is checked in full, including its permission and scope rule, and its
`File-Name` header is decoded, before the body is read. The handler's
`input.body` is `{ name, bytes }`. A route that answers raw bytes may return a
stream. Nothing outside `src/platform/files` reads the storage keys.

## Endpoints

| Route               | Meaning                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`       | Liveness: the process is running. Does not touch the database                                                                                                    |
| `GET /health/ready` | Readiness: 200 if the database answers, 503 if it does not or takes more than 2 seconds. The response never says why; the cause is logged when the state changes |
| `GET /openapi.json` | The OpenAPI document, built from the route schemas                                                                                                               |

## Routes and the policy

Every route except the probes and `/openapi.json` is registered from a
contract in `packages/domain` (`registerRoutes()` in `src/routes/register.ts`)
and served under `/api`. A route without a contract stops the API at start-up,
and so does a contract that breaks the route rules, has more than one success
response, or names a scope rule that no module resolves. Request bodies are
limited to 64 KiB, except where a route sets its own limit (the logo upload
takes a little over 200 KB as base64). A client has 70 seconds to send its
headers and 2 minutes for the whole request, and an idle connection is kept
65 seconds. A raw response (the public stylesheet and logo) is sent as the
handler returns it, in a content type the contract names. An error keeps only
the `Retry-After` and `Allow` headers it carries.

The API refuses to start if `HTTP_PROXY`, `HTTPS_PROXY` or `NODE_USE_ENV_PROXY`
is set, in any case, because a proxy would resolve names where the API cannot
check them (ADR 0010).

One module decides whether a caller may run a route (`src/policy/policy.ts`).
It checks permissions, never role names, in this order:

1. Before the body is read, with no database: the route's app, a session in
   the state the route needs (MFA settled, or the session an `auth` route
   states), and re-authentication in the last 5 minutes for a step-up route.
   No session or one waiting for MFA gets 401. A session of the other app,
   or a stale step-up, gets 403.
2. In the request's one tenant transaction, opened with the session's tenant:
   an active membership (403), the module switched on (404), the permission
   from the role map (403), then the route's scope rule (404). An object
   outside the caller's scope answers exactly as a missing one does.
3. The handler runs in that transaction, with the parsed input and the
   context, and commits with it. A handler has no other way to the database
   and does not check access itself.

The public tenant routes (`/api/public/tenants/:slug`, `/theme.css` and
`/logo`) need no session and set no tenant: they call the two public functions
of ADR 0019. An unknown, suspended or malformed slug gets the same 404. The
stylesheet is built by `themeCss()` from validated tokens only: the tenant's
own tokens when it has saved them, and its preset look when it has none or they
no longer pass the checks, in which case the code `theme_tokens_invalid` is
logged and the tokens never reach the response.

A tenant admin saves their own design tokens with `PUT /console/settings/theme/tokens`
and goes back to the preset with `DELETE` on the same path, or by saving a
preset or brand colour, which clears the tokens in the same transaction. The
save parses the body again with `tokenSetSchema` and `checkTokens()` and answers
400 with every problem by token path (`body.tokens.light.colorInk`). The version
and the `platform.theme.changed` event name each changed token, with null where
none was set. Stored tokens that no longer pass the checks are not in use, so
clearing them (by removal, or by saving a preset or brand colour) writes the event
with the marker `{ before: 'unusable', after: null }` under
`app.tenant_theme.tokens`, never the failing values. A save that leaves the
tokens alone, such as a logo change, neither clears them nor records that.
Clearing writes no configuration version, because the diff schema for
`platform.theme` has no entry for tokens that are not in use.

The team routes (`src/platform/team/`) let a tenant admin list members and
pending invitations, invite, revoke an invitation, change roles, suspend,
reinstate and remove, all under `platform.members.manage` with step-up on every
change. A change locks the team's memberships, so concurrent changes run one at
a time; refuses the admin's own membership and any change that would leave no
active member who can manage the team (409); and, for a suspension, a removal or
a role change, ends the member's sessions in this tenant through the auth module.
Applicants are not on the team, so their membership ids answer 404. Member names
and addresses come from the party module.

`pnpm tenant:create --slug <slug> --name <name> --admin-email <address>`
(`src/operator/`) makes a tenant as `app_worker`, records
`platform.tenant.created` with the actor `operator`, and emails the first
administrator's invitation. It checks the arguments with the shared schemas before
it connects and prints the tenant's id and slug, never a token or a link.

A handler writes a configuration version for a change to settings, a theme or
a module switch with `context.config.record(entityType, entityId, diff)`, in
the same transaction and with the acting membership as author. Two requests
that write the same version cannot both succeed: the second gets a 409. The
table keeps its diff as an object, so the list of changes is stored under
`changes`.

A handler records audit events only through its context: `context.audit.record()`
for a state change and `context.audit.read()` for a sensitive read, both bound to
the request's transaction and the acting membership.

`src/modules.ts` composes each module's routes and scope rule resolvers
(`composeModules()`, which `main.ts` passes to `buildApp({ routes, resolvers })`)
and passes in any platform dependency a module declares. A module never imports
from this app. The platform supplies the `tenant` rule. Refusals are logged with a reason code and are
not audited. `test/support.ts` has the helpers a route test uses: a stand-in
auth module, test sessions, and `expectLooksMissing()`, which proves another
user's object in the same tenant answers as a missing one.

Every response carries the headers of ADR 0006 (`src/headers.ts`).

## Logs

One JSON object per line on standard output. Every line written while handling
a request has a `requestId`, which is also the `x-request-id` response header
and the `requestId` in every error response. The API always makes its own id
and ignores one sent by the caller.

A log line never holds:

- the value of a key that names a credential: anything containing `password`,
  `token`, `secret`, `cookie`, `authorization`, `jwt`, `apikey`, `signature`
  and the like, so `smtpPassword` and `csrfToken` are censored too;
- the value of a key that is personal. A key is split into words at case
  changes and punctuation, and censored if it holds a personal word or phrase,
  such as `email`, `phone`, `ip`, `first name`, `referer` or `answers`, or a
  column the classification map (`packages/db/classification.ts`) marks as
  personal or special category. So `userEmail` and `clientIP` are censored and
  `relationship` is not. This holds however deep the key sits in the logged
  object, and for the fields of a child logger, which cannot bring its own
  formatters;
- the headers or body of a request, or the address of the caller;
- the path of a request that matched no route, which is logged as
  `[no route]`;
- the value of a query parameter: a URL is logged with its query keys only,
  and a key that does not look like a parameter name is censored. An auth
  route is logged with no query and its route pattern in place of its path;
- the message of an error, because the message of an error from Node.js or a
  library can hold input (`JSON.parse` quotes it, and PostgreSQL puts the
  rejected value in its messages). An error is logged as its type and code.
  An error from the database is logged as its SQLSTATE code and the table,
  column and constraint it names. Only an error we write ourselves, such as
  `ApiError`, which extends `SafeError`, keeps its message. A thrown string is
  logged as its length.

The stack of an error is logged as frames only.

## Errors

Every error is a problem details document (RFC 9457) with the content type
`application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Some fields are not valid. Fix the fields listed and try again.",
  "requestId": "0b5c4a1e-0d4c-4e0e-8a0f-3f6f3a8f4b1d",
  "errors": [{ "field": "body.title", "message": "Enter at least 3 characters." }]
}
```

This covers errors raised before a route runs, such as a malformed URL, and a
request with a content type other than JSON. The text comes from this package,
from an `ApiError` thrown on purpose, or from a custom check in a domain schema. The message of any other error is never
sent, and neither is a stack trace, a submitted value or a database detail.
An unexpected failure answers with 500 and the request id, and the full error
goes to the log.

## OpenAPI document

`openapi.json` in this folder is the document the running API serves. A test
compares the two, so a change to a route schema shows as a diff in review. To
accept an intended change:

```sh
pnpm test:unit -- apps/api -u
```

## Tests

`pnpm test:unit -- apps/api` runs these tests. None needs a database: the
readiness check is tested with a fake database check.

`GET /console/warehouse/snapshot` (`src/platform/warehouse/`) lets a tenant admin
download one PostgreSQL load script of the tenant's warehouse tables (ADR 0016).
It is built inside the request and its transaction from the party and grants
contributions plus the platform's `date` table, and writes only the columns
`warehouseColumns()` allows under the classification map, so no personal or
special category value is emitted. Load it with
`psql -v ON_ERROR_STOP=1 -f warehouse-snapshot-<date>.sql`. The script is UTF-8
and begins with `SET client_encoding = 'UTF8'`, so it loads the same under any
client encoding or locale (a Windows terminal's WIN1252, for one). Values are escaped
for `COPY`'s text format in `escape.ts`. A script over 50 MB is refused with a
400 that asks the admin to contact the operator. `platform.warehouse.exported`
records the rows in each table, keyed by the classified column of the table's
key (`countField()`).
