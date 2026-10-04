// SPDX-License-Identifier: AGPL-3.0-or-later

/** The global that react-style-singleton, under Radix's scroll lock, reads its nonce from. */
interface NonceGlobal {
  __webpack_nonce__?: string;
}

/**
 * Radix locks the page's scroll by adding a `<style>` element. The page's
 * content security policy allows that element only with the page's nonce
 * (ADR 0006), which the web server writes into a `csp-nonce` meta tag, so
 * hand the nonce to the library that adds the element. A page with no such
 * tag has no policy to satisfy and is left alone.
 */
export function shareStyleNonce(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  // Browsers hide the attribute once the page has loaded, but keep the property.
  const nonce = meta?.nonce || meta?.getAttribute('nonce');
  if (nonce) (globalThis as NonceGlobal).__webpack_nonce__ = nonce;
}
