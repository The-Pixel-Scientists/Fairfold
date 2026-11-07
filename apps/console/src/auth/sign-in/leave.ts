// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sends the browser to the identity provider's address, exactly as the
 * server gave it. The address is never built or changed here, because the
 * browser-binding cookie the start route set must reach the callback.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
