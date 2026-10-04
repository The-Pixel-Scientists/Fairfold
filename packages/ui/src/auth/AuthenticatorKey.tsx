// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AuthenticatorKeyProps {
  /** The key to type into an authenticator app. */
  secret: string;
  /** The `otpauth://` address that carries the key, for the link and, later, a QR code. */
  uri: string;
}

/** Only an authenticator address becomes a link, whatever the API sent. */
const AUTHENTICATOR_URI = /^otpauth:\/\/totp\/[^\s]+$/;

/**
 * The set-up key for an authenticator app, always shown as text, and a link
 * that opens the app on this device. A QR code needs an encoder, which
 * would be imported here and nowhere else.
 */
export function AuthenticatorKey({ secret, uri }: AuthenticatorKeyProps) {
  const grouped = secret.replace(/(.{4})(?=.)/g, '$1 ');

  return (
    <div className="flex flex-col gap-2 rounded-md border border-divider bg-sunken p-3">
      <p className="text-body font-medium text-ink">Set-up key</p>
      <p className="font-mono text-lg break-all text-ink select-all">{grouped}</p>
      {AUTHENTICATOR_URI.test(uri) && (
        <p className="text-body">
          <a href={uri}>Open in your authenticator app</a> if it is on this device.
        </p>
      )}
    </div>
  );
}
