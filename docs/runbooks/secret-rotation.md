# Rotate the auth secret and other secrets

Use this page to replace the secret that protects two-factor and single
sign-on secrets in the database, and to replace the other secrets the services
read. It works the same on the managed service and on a self-hosted install.
The rules are in the "Secrets at rest" section of
[ADR 0010](../adr/0010-authentication-security-rules.md).

| | |
| --- | --- |
| **When to use it** | On a schedule you set (at least once a year is sensible); at once if a secret may have been seen by someone who should not have it; when someone who could read secrets leaves the team. |
| **Who may run it** | An operator with access to the secret store and to run one-off jobs. Ask a second person to check the counts at step 5. |
| **What you need** | Write access to the secret store (Secret Manager on the managed service, the mounted secret files on a self-hosted install); the ability to restart the API; the escrow record; about an hour for a small install. |
| **What usually starts it** | The rotation schedule, a security incident, or a staff change. |

Do not rotate during a restore. Finish the restore first.

## What the auth secret protects

The auth secret is a key the API derives other keys from. It protects:

| Value | Where it is stored | Can it be re-keyed? |
| --- | --- | --- |
| Two-factor (TOTP) secrets | `auth.two_factor` | Yes, by the command below |
| SSO client secrets and SAML private keys | `auth.sso_provider` | Yes, by the command below |
| Backup codes | `auth.two_factor`, as HMACs | No. People must make new codes |
| Short-lived values (for example a sign-in in progress) | Not kept long | Not needed. They use the current version only |

Session tokens and verification values are hashed, not encrypted, so
rotation does not affect them. Anyone who holds the auth secret and a copy of
the database can read the first two rows, so a suspected exposure of the secret
is urgent.

## Rotate the auth secret

The settings are in `apps/api/src/auth/settings.ts`. Each key version is a
secret of at least 32 random bytes, named `TPS_AUTH_SECRET_<n>` (or
`TPS_AUTH_SECRET_<n>_FILE` to read it from a mounted file, which is what you
should use). `TPS_AUTH_SECRET` is version 1. `TPS_AUTH_SECRET_CURRENT` names the
version that encrypts new values; it is required when more than one version is
set. A new version must differ from every other version.

### Add the new version

1. **Make the new secret.** On a machine you trust, make 32 or more random
   bytes, for example `openssl rand -base64 48`. Do not type it into a
   command line or a ticket.
2. **Put it in escrow first**, with its version number, following the escrow
   record. The managed service and the backups cannot be read without it.
   Success: a second operator confirms the escrow copy opens.
3. **Add it beside the old version**, not instead of it.
   - Managed service (Google): add a new secret version in Secret Manager,
     mount it as a file, and name it `TPS_AUTH_SECRET_2_FILE`. The Terraform
     for this is in `infra/terraform/gcp/`. **Waits for staging:** no
     environment has Secret Manager yet.
   - Self-hosted: write the new secret to a file only the service can read, and
     set `TPS_AUTH_SECRET_2_FILE` to its path. If your old setting is
     `TPS_AUTH_SECRET_FILE`, rename it to `TPS_AUTH_SECRET_1_FILE`: you cannot
     set `TPS_AUTH_SECRET` and `TPS_AUTH_SECRET_1` together.
4. **Keep version 1 as the current version for now.** Set
   `TPS_AUTH_SECRET_CURRENT=1` and restart every API instance. Success: the API
   starts. If it refuses, it names the setting that is wrong (too short, a
   published value, a repeat of another version, or `TPS_AUTH_SECRET_CURRENT`
   missing). Fix it and restart. Nothing has changed for users.

   Why not switch straight away: while instances restart one at a time, an
   instance that does not know version 2 cannot read a value another instance
   sealed with it. Adding the version first means every instance can read both
   before any instance writes one.

5. **Switch the current version.** Set `TPS_AUTH_SECRET_CURRENT=2` and restart
   every API instance. New values are now sealed with version 2; old values
   still open with version 1. People who were part-way through signing in may
   have to start again.

### Re-encrypt what is already stored

6. **Run the re-encryption command.** It needs the same settings as the API
   (the database host, the `app_auth` role's password, the SMTP settings and the
   auth secret versions) and connects only as `app_auth`. Run it where the API
   runs, with those settings in its environment:

   ```
   node apps/api/src/auth/rotation/reencrypt-secrets.ts
   ```

   It refuses to start, with exit code 2, if the settings fail the API's own
   checks or only one version is configured. It re-encrypts one row at a time,
   so you can stop it and run it again. It never prints a secret, a key or an id.
7. **Read the counts.** It prints:

   ```
   Re-encrypted <n> TOTP secrets to key version 2.
   Re-encrypted <n> SSO providers to key version 2.
   Asked <n> of <n> users with backup codes on an older key version to generate new ones.
   ```

   Exit code 0 means every row is on the newest version. Exit code 1 means it
   stopped part-way with an error code (a database error code, or
   `reencryption_failed`): run it again. Suspended tenants' secrets are
   re-encrypted too.
8. **Check the event.** The command writes one `secrets_re_encrypted` event to
   `auth.audit_event`, with the key version and the three counts. If it
   stopped part-way, the event has the reason `incomplete`. A second person
   confirms the event is there.
9. **Run the command a second time.** It must print
   `Re-encrypted 0 TOTP secrets` and `Re-encrypted 0 SSO providers`. That proves
   nothing is left on an older version. The command does not report rows that
   stay on version 1 any other way.
10. **Deal with backup codes.** Backup codes are HMACs and cannot be re-keyed.
    The command emails each user whose codes use an older version and asks them
    to generate new ones. If the third line of the output shows any, wait for
    people to do it. Running the command again emails everyone who still has
    old codes again, so leave a day or more between runs. The command also
    prints "Do not remove an older key version while any user still has codes
    on it." Take that literally.

### Remove the old version

11. **Escrow the new state.** The escrow record must now list version 2 as
    current and version 1 as retired.
12. **Only then remove version 1** from the running services: delete
    `TPS_AUTH_SECRET_1_FILE` and restart the API. Do this only when the second
    run showed zero and no user has backup codes on version 1.
13. **Keep version 1 in escrow for 7 years**, or until the last backup that holds
    values it sealed has expired, whichever is later. A restore from an old
    snapshot needs it ([Restore the service from a backup](restore.md#restore-the-auth-secret)).

### What not to do

- Never remove an old version while the command reports rows left, or while any
  user still has backup codes on it.
- Never pass a secret on a command line or paste it into a ticket, a chat or a
  log.
- Never rotate during a restore.
- Never reuse a secret as a new version.

### If this fails

Until step 12, the old version still opens everything, so stopping at any step
leaves the service working. To go back after step 5, set
`TPS_AUTH_SECRET_CURRENT=1` and restart: values sealed with version 2 stay
readable while version 2 is still configured, so do not remove it until the
command has run again with the old version current. After step 12, restore the
old version from escrow, add it back, and restart.

## Rotate the other secrets

Each secret is a mounted file in the settings below. Change the file, then
restart the service that reads it. On the managed service the file comes from
Secret Manager; **waits for staging** for how a new Secret Manager version
reaches Cloud Run. Put every new value in escrow where the escrow record says
it is needed.

| Secret | Setting | Restart |
| --- | --- | --- |
| Database role passwords | `TPS_DB_<ROLE>_PASSWORD_FILE` for each login role the roles script creates | See below |
| SMTP password | `TPS_SMTP_PASSWORD_FILE` | API and worker |
| File store keys, one per purpose | `TPS_STORAGE_WRITE_SECRET_ACCESS_KEY_FILE`, `TPS_STORAGE_READ_SECRET_ACCESS_KEY_FILE`, `TPS_STORAGE_SCANNER_SECRET_ACCESS_KEY_FILE` (with their key ids) | API and worker |
| Platform key for subject keys | `TPS_SUBJECT_KEK_FILE`, `TPS_SUBJECT_KEK_VERSION` | Do not rotate by hand. Every version stays in escrow, and no rotation command exists yet |
| Backup store keys and the live-store read key | `TPS_BACKUP_STORE_CREDENTIALS_FILE`, `TPS_BACKUP_SOURCE_CREDENTIALS_FILE` | The backup job's next run |
| Backup role password | `TPS_DB_BACKUP_READER_PASSWORD_FILE` | See below, then the backup job's next run |
| Backup encryption recipients | `TPS_BACKUP_RECIPIENTS_FILE`, `TPS_BACKUP_KEY_ID` | The backup job's next run |

### Database role passwords

Rotation briefly breaks connections, because PostgreSQL has one password per
role. Plan a short maintenance window.

1. Write the new password to the role's file.
2. Run `node packages/db/scripts/db.ts prepare`. The roles script sets each
   role's password, as a SCRAM verifier, from the files. It never holds a
   password in clear on the server.
3. Restart the services that use the role. Success: they reconnect and the API
   health check passes.

Rollback: put the old file back, run `prepare` again, restart. For the managed
service the admin credential that runs this goes only to the step that runs the
roles script.

### The backup role and the backup encryption keys

The backup role's password rotates as above. Rotate the encryption keys by
adding a new `age` recipient and a new `TPS_BACKUP_KEY_ID`. Old snapshots are
not re-encrypted: each object records the key version that encrypted it in the
manifest, so you must keep every private key in escrow while any snapshot it
protects exists (7 years after the last copy expires). Generate key pairs on an
offline machine. Never on a production host.

Rollback: set the previous recipient and key id back.

### SMTP and file store keys

Create the new credential with the provider first, put it in the file, restart,
send a test email or upload a test file, and only then revoke the old
credential. Rollback: put the old file back, restart, and revoke the new
credential.
