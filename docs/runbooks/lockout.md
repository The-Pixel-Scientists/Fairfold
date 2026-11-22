# Help a locked-out person

Use this page when someone cannot sign in. It tells you whether they only
need to wait, need to reset their password, or have lost their second factor.

## When to use this

- A person says they cannot sign in.
- The `SignInFailuresHigh` or `MfaFailuresHigh` alert fires. Both name this
  page. Their thresholds are in `infra/observability/alerts/tps.rules.yaml`.
  A spike can be an attack, so read
  [Respond to a security incident](incident.md) too.

## Before you start

- You are a platform operator. A funder's administrators cannot reset
  anyone's password or authenticator app. They can only suspend or remove a
  membership. If an administrator asks, you are the route.
- Have somewhere outside the database to keep a record.
- There is no lockout in the software. A person who gets a password wrong is
  slowed down, not locked out. Passkeys, single sign-on and password reset
  keep working during a delay.

## Steps

### Work out which problem it is

1. **Ask what the person sees.**

   | What they see or say | What it is | Go to |
   | --- | --- | --- |
   | The password is refused, then they must wait | A sign-in delay | Step 2 |
   | A message that too many emails were requested | A rate limit | Step 2 |
   | They forgot their password | A forgotten password | Step 3 |
   | They know their password but cannot give a code | A lost authenticator app | Step 4 |

2. **Delays and rate limits clear on their own.** After 5 failed sign-ins in
   15 minutes from one person on one device, each further attempt waits 30
   seconds, doubling each time to at most 15 minutes. The doubling resets
   after 24 hours without a failure. Failures from other devices do not slow
   someone on a device they have used before. Devices that have not signed in
   to that account share a limit of 50 failures in 15 minutes per client
   address. Sign-up, reset and verification emails are limited to 3 per
   address and 20 per client address each hour. After 5 wrong second-factor
   codes the pending sign-in is dropped, and the person starts again. Tell
   the person to wait, then try once and carefully. Do not clear a delay by
   editing the database.
3. **A forgotten password is self-service.** Ask them to use the forgotten
   password link on the sign-in page and follow the email. Completing a reset
   signs them out everywhere and clears their delays. If the email does not
   arrive, ask them to check their spam folder. Then check the cell's mail
   settings and the limit of 3 emails an hour.
4. **A lost second factor: try backup codes first.** Ask whether they saved
   backup codes when they set up the authenticator app. Each code works once
   in place of the app's code. Afterwards they should make new codes in their
   profile. Staff who added a passkey can sign in with it instead.
5. **With no backup code and no passkey, only an operator can help.** Do the
   identity check in step 6 first.

### Check who is asking

6. **Check the person's identity before you do anything else.** Someone who
   takes over an account can see applicants' data. Use a route you control,
   not a reply to the request. For example, call back on a number the
   funder's administrator already holds, or ask the administrator to confirm
   through a channel you can verify. A message from the same email address is
   not proof. In the record, write who asked, how you checked and who
   confirmed. Use the funder's name and the ticket number, not an email
   address.

### Clear the second factor

7. **No command is available yet.** The operator command that clears a
   person's second factor and signs them out is not on `main`, and neither is
   its list of accepted identity checks. Until it is, do not edit the
   database and do not ask a funder's administrator to try. Record the
   request, finish the identity check, and pass the request to the engineering
   lead, who will say when the command can be used. This page will then give
   its exact name and the identity checks it accepts.

Once the command exists, the person will sign in with their existing password,
which does not change, and will have to set up an authenticator app again.

## Check it worked

- The person signs in and reaches their page.
- For a password reset, the auth events show "password reset completed".
- The alert that sent you here has cleared, or you have recorded why it is an
  attack.

## If something goes wrong

- The delay never seems to end: check whether many people share one client
  address, for example behind a proxy that hides their addresses. Check the
  trusted proxy settings of the API.
- Reset emails do not arrive: check the mail settings and the API's logs for
  send errors. Never send a password by another route.
- You suspect someone else is trying to get in: treat it as an incident under
  [Respond to a security incident](incident.md).
- A funder's administrator asks you to set a password for someone: decline.
  Send the person to the reset email.

## Record

In the ticket, write: the date and time, the funder, what the person
reported, which case it was, how identity was checked and by whom, what you
did and the result. Never write passwords, codes, tokens or email addresses.

The software writes an auth event for each account change: password reset
completed, backup code used, sessions revoked. The identity check is
evidenced only by your record.
