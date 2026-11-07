// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first check on a SAML response or an IdP metadata document, before any
// XML parser sees it (ADR 0010, SAML rules). The bytes are capped, then
// decoded strictly in the one encoding their first bytes show: UTF-8, or
// UTF-16 with a byte order mark or a leading `<`. In the text, `<!` may only
// open a comment or a CDATA section, so `<!DOCTYPE` and `<!ENTITY` are
// refused in any case and any encoding. A declared encoding that differs from
// the one found is refused too. Only the returned text, never the bytes, may
// go on to a parser, so no parser can read them another way.

export const MAX_XML_BYTES = 262_144;

/** `dtd` is ADR 0010's reason code; `malformed` covers input no parser should see. */
export type GuardRefusal = 'dtd' | 'malformed';

export class XmlRefused extends Error {
  readonly reason: GuardRefusal;

  constructor(reason: GuardRefusal) {
    super(`The XML was refused before parsing: ${reason}.`);
    this.reason = reason;
  }
}

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be';

function encodingOf(bytes: Uint8Array): Encoding {
  const [first, second] = bytes;
  if ((first === 0xff && second === 0xfe) || (first === 0x3c && second === 0x00)) {
    return 'utf-16le';
  }
  if ((first === 0xfe && second === 0xff) || (first === 0x00 && second === 0x3c)) {
    return 'utf-16be';
  }
  return 'utf-8';
}

const DECLARED = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([^"']*)["']/i;
const ALLOWED_DECLARATIONS: Record<Encoding, readonly string[]> = {
  'utf-8': ['utf-8'],
  'utf-16le': ['utf-16', 'utf-16le'],
  'utf-16be': ['utf-16', 'utf-16be'],
};
const MARKUP_DECLARATION = /<!(?!--|\[CDATA\[)/;

/** The document as text, or XmlRefused. */
export function guardXml(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > MAX_XML_BYTES) throw new XmlRefused('malformed');
  const encoding = encodingOf(bytes);
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new XmlRefused('malformed');
  }
  if (text.includes('\0')) throw new XmlRefused('malformed');
  if (MARKUP_DECLARATION.test(text)) throw new XmlRefused('dtd');
  const declared = DECLARED.exec(text)?.[1]?.toLowerCase();
  if (declared !== undefined && !ALLOWED_DECLARATIONS[encoding].includes(declared)) {
    throw new XmlRefused('malformed');
  }
  return text;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The text of a posted `SAMLResponse`: strict base64, line breaks allowed, then guardXml. */
export function decodeSamlResponse(value: string): string {
  const compact = value.replace(/[\r\n]/g, '');
  if (!BASE64.test(compact) || compact.length % 4 !== 0) throw new XmlRefused('malformed');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64') !== compact) throw new XmlRefused('malformed');
  return guardXml(bytes);
}
