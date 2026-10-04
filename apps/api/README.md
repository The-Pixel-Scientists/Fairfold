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
| `TPS_SMTP_HOST`                         | With the other mail settings                       | Mail server host. Optional for now: the API does not send mail yet. Once any mail setting is set, the host, port, TLS mode and sender are all required                                                                                 |
| `TPS_SMTP_PORT`                         | With the other mail settings                       | Mail server port                                                                                                                                                                                                                       |
| `TPS_SMTP_TLS`                          | With the other mail settings                       | `starttls`, `tls` or `none`, which works only for a mail server at a loopback IP address (127.0.0.0/8 or `::1`), and with a login only when `TPS_DEV=1`. The relay must share the API's network namespace, as the stack's Mailpit does |
| `TPS_SMTP_USER`                         | With the password                                  | Mail server login. Set it together with the password, or leave both out                                                                                                                                                                |
| `TPS_SMTP_PASSWORD` or `_FILE`          | With the user                                      | Mail server password, or the path of the file that holds it                                                                                                                                                                            |
| `TPS_SMTP_FROM`                         | With the other mail settings                       | The address emails are sent from                                                                                                                                                                                                       |
| `TPS_LOG_LEVEL`                         | No                                                 | `fatal`, `error`, `warn`, `info` (the default), `debug`, `trace` or `silent`                                                                                                                                                           |
| `TPS_DEV`                               | No                                                 | `1` for development: the listener binds to `127.0.0.1`, and the fixed development passwords are accepted, but only against a database server on this machine                                                                           |

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
limited to 1 MiB.

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
