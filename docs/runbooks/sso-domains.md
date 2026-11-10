# Settle a single sign-on domain dispute

Use this page when two organisations (tenants) both say an email domain is
theirs, when a domain has lapsed or been sold, or when a funder leaves. It
works the same on the managed service and on a self-hosted install. The rules
are in the "SSO" section of
[ADR 0010](../adr/0010-authentication-security-rules.md).

| | |
| --- | --- |
| **When to use it** | A funder's administrator reports that adding a domain failed with "Another organisation has already verified this domain. Contact support if it should be yours."; a domain holder asks you to release a domain; a tenant leaves. |
| **Who may run it** | An operator, with a second person who approves any change that stops staff signing in. |
| **What you need** | The two administrators' contact details from the onboarding record, a place to record the decision, and 1 to 5 working days. No database access is needed for the holder-removes path. |
| **What usually starts it** | A support request from the claimant. The conflict is also meant to leave an audit event (see [Find the conflict](#find-the-conflict)). |

**Status on 9 November 2026.** The database rules, the DNS check and the
console screens exist. The API routes that save, verify and remove a domain,
the conflict audit event, and any operator command that releases another
tenant's domain do not exist yet. The steps below say **no command yet** where
that matters. Check this page against the build before you rely on it, and
update it when those pieces land.

## How domain verification works

- A funder adds a domain to one of its single sign-on providers in the console
  (Settings, Single sign-on, **Add domain**). The platform makes a random
  token for that tenant, provider and domain.
- The funder publishes a DNS TXT record at `_sso-verification.<domain>` with
  the value `sso-verification=<token>`, then chooses **Verify domain**. The
  platform looks the record up itself, from the system's DNS servers.
- Until verified, the domain is pending. **A pending claim blocks nobody.** Any
  number of tenants can have the same pending domain.
- Once verified, **a domain belongs to that one tenant** and no other tenant
  can verify it. The database enforces this.
- If the DNS proof succeeds and another tenant already holds the domain, the
  claimant is refused with the message above. The message names no tenant. The
  conflict is recorded in the audit log.
- A token made for another tenant, provider or domain proves nothing. If a
  claimant pastes the wrong token, verification fails and that is by design.
- Staff can sign in by SSO only with an email address in one of their
  provider's verified domains.

## Find the conflict

1. **Get the facts from the claimant**: their organisation, the domain, and
   when they tried. Ask them not to try again.
2. **Find the audit event.** ADR 0010 names an `sso_domain_conflict` event in
   the authentication audit log (`auth.audit_event`). **No command yet:** the
   code does not write it, and there is no screen or command that lists it. Until
   it does, rely on the claimant's report.
3. **Find the holder.** You need to know which tenant has verified the domain.
   **No command yet:** there is no operator command to look a domain up. On a
   self-hosted server where you are the superuser, a read-only query on
   `auth.sso_domain` where `state = 'verified'` and `domain = '<domain>'`
   gives the holder's tenant id. On the managed service, **waits for staging**:
   the operator's database role cannot read across tenants by design, and no
   such access should be added to answer this question. Note in the dispute
   record that you read another tenant's row and why.

## Settle the dispute

Do not tell either tenant who the other is until both agree.

1. **Contact the holder's administrator separately.** Ask whether they still
   use the domain for staff sign-in. Do not say who is asking.
2. **Contact the claimant separately.** Ask them to prove they control the
   domain: have them remove the old record, make a fresh claim (a fresh token)
   and show you the TXT record at their DNS host. Verification itself will keep
   failing with the conflict message until the holder releases the domain, but
   the claimant's fresh token shows control.
3. **Decide and record it**, with a second operator: the domain, both tenants,
   what each said, the evidence, the decision and the date. Keep this record
   with your support records, not in the code repository.
4. **If the holder agrees to release the domain**, ask the holder's administrator
   to remove it themselves:
   1. In the console, go to Settings, then Single sign-on.
   2. On the provider that holds the domain, choose the domain's **Remove domain**
      button, and confirm **Remove domain** in the dialog "Remove domain
      `<domain>`?". The screen asks the administrator to confirm they are who
      they say they are first.
   3. Tell the claimant, in the same message, to add the domain, publish the
      new record and choose **Verify domain**. Success: the domain shows as
      verified.
5. **If the holder does not agree, or cannot be reached**, you cannot move the
   domain. **No command yet:** there is no operator action to release another
   tenant's verified domain. Never edit `auth.sso_domain` by hand: the rows are
   protected for good reason, and an edit leaves no audit event. Tell the
   claimant what you can say without naming the holder ("the domain is already
   in use and its holder has not released it"), and record that you cannot
   resolve it. This is a decision for the project lead: a new, audited operator command
   would be authentication code and would need external review.

## What removing a domain does

When the holder removes a verified domain:

- Staff with an email address in that domain no longer match the provider, so
  they cannot sign in by single sign-on at the holder. The console tells the
  administrator they will sign in with a password and code instead.
- Their memberships and roles stay. Removing a domain does not remove people.
  The code removes the domain row only, and open sessions are not ended by it;
  **confirm this on staging** when the API routes exist.
- The holder's administrator should invite affected staff to sign in with a
  password and two-factor, or add another verified domain, before the
  removal, so no one is locked out. If someone is locked out, use the lockout
  runbook.
- Removing a whole provider is different: its domains go too, and single
  sign-on identities linked to it are deleted with it.

## Other cases

- **A domain that has lapsed or been sold.** The new owner's claim is refused
  the same way as any other. Ask the old holder's administrator to remove the
  domain, and follow the steps above. If the old holder is gone, see "A tenant
  leaves".
- **A tenant leaves.** A tenant's domains are held until the tenant is retired.
  If the tenant has asked to leave, the funder removes its domains in the
  console before it goes, or you remove the tenant under its retention rules
  (**no command yet**: no tenant retirement command exists). A retired tenant's
  verified domain is free once its provider is removed.
- **A token made for another tenant or provider.** Verification is refused. This
  is by design: tell the claimant to use the record shown next to their own
  domain in the console, not a record copied from elsewhere.
- **A tenant moves to another cell.** DNS tokens are per tenant and per cell, so
  the funder re-verifies its domains in the new cell. See
  [Move a tenant to another cell](tenant-move.md).

## If a step fails

Every step above that changes anything is done by the holder in the console,
so you can stop at any time and nothing is left half-done. If the claimant's
verification still fails after the holder removed the domain, check that the
TXT record is at `_sso-verification.<domain>`, that its value is
`sso-verification=` followed by the token, and that DNS has updated. A lookup
that times out reports as a failed lookup, not a missing record: try again in a
few minutes.
