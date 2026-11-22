# Single sign-on

Single sign-on lets your staff sign in with your organisation's own identity
provider. You need the **Administrator** role. Choose **Settings**, then
**Single sign-on**. Only administrators see that section.

The software supports two kinds of provider: **OIDC** and **SAML**. Your IT
person will know which one your identity provider uses and can supply the
values below.

## Confirm it is you first

Every change here asks you to confirm it is you. The box appears before a form
opens, so nothing you type is lost. See
[Account security](account-security.md#confirm-it-is-you-first).

## Add a provider

1. Choose **Add OIDC provider** or **Add SAML provider**.
2. Enter a **Display name**, for example `Example Trust sign-in`.
3. For OIDC, enter the **Issuer or discovery URL** (an https address), the
   **Client ID** and the **Client secret**.
   For SAML, enter the **Identity provider entity ID**, the **Single sign-on
   URL** (an https address) and the **Identity provider signing certificate**.
   Paste the certificate, or choose a certificate file under 16 KB. The file is
   read in your browser and not uploaded.
4. Under **Multi-factor authentication**, choose how staff prove a second
   factor (see below).
5. Choose **Add OIDC provider** or **Add SAML provider**.

The provider card then shows values your identity provider needs from us. For
OIDC that is the **Redirect URI**. For SAML it is the **Service provider
entity ID** and the **ACS URL**. Each has a copy button. Enter them in your
identity provider.

To change a provider, open its change form. Leave **Client secret** blank to
keep the saved one. A SAML certificate is shown as a SHA-256 fingerprint. Paste
the certificate again to replace it. Then choose **Save provider**.

### Multi-factor authentication

Staff who have multi-factor authentication (MFA) from neither the provider nor
this service cannot finish signing in. Choose one of two ways:

- **Trust MFA reported by this provider.** List the values your provider sends
  when it has done MFA: `amr` or `acr` for OIDC, `AuthnContextClassRef` for
  SAML. Staff who used MFA at the provider are not asked for a code here. Enter
  at least one value.
- **Ask for a code from this service as well.** Staff always enter a code from
  their authenticator app after the provider.

If you are unsure what your provider sends, choose the second.

## Verify an email domain

A provider applies to staff by the domain of their email address, and only
after you prove you own the domain.

1. On the provider card, enter the **Email domain**: the part after the `@`,
   for example `example.org`. Add it.
2. The card shows a DNS record with a **Record name** and a **Record value**.
   Add that record at your DNS host.
3. Wait a few minutes for DNS to update.
4. Choose **Verify domain**.

The domain shows **Verified**, or **Waiting for verification** until the
record is found. If it is not found, the page says so. Check the name and value
match exactly, wait, and try again.

## What staff see

On the sign-in page, staff enter their **Work email address** under **Sign in
through your organisation** and choose **Continue with your organisation's
sign-in**. If the address matches a verified domain, they go to your identity
provider and come back signed in. If not, the page says single sign-on could
not start and suggests the password.

Password sign-in stays available. The software does not yet make staff at a
domain use single sign-on: enforced single sign-on is not yet available.

If sign-in fails, staff see "Single sign-on did not work", for example when the
sign-in took too long or your organisation did not confirm MFA. They can try
again or ask you.

## Turn it off safely

Remove a domain to stop one group using it. Remove the provider to stop all of
its domains. Choose **Remove domain** or **Remove provider** and confirm. Staff
then sign in with a password and code instead.

Before you remove one:

1. Check that everyone who uses it has a password and an authenticator app. Ask
   anyone who has not to set them up first.
2. Keep another administrator signed in while you test.

## What your identity provider and the operator do

Your identity provider decides who may sign in there and how strongly it checks
them. The software cannot see that. Your DNS host holds the verification
record. The operator provides the service itself, including its address.
