// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { decodeSamlResponse, guardXml, MAX_XML_BYTES, XmlRefused } from './guard.ts';

const RESPONSE =
  '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1">' +
  '<!-- a comment --><x><![CDATA[text]]></x></samlp:Response>';
const DTD = '<!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd">]>';

const utf8 = (text: string) => Buffer.from(text, 'utf8');
const utf16le = (text: string, bom = true) =>
  Buffer.concat([Buffer.from(bom ? [0xff, 0xfe] : []), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string, bom = true) => {
  const le = Buffer.from(text, 'utf16le');
  return Buffer.concat([Buffer.from(bom ? [0xfe, 0xff] : []), le.swap16()]);
};

function refusal(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    if (error instanceof XmlRefused) return error.reason;
    throw error;
  }
  throw new Error('not refused');
}

describe('guardXml', () => {
  it('returns the text of a UTF-8 or UTF-16 document, comments and CDATA allowed', () => {
    expect(guardXml(utf8(RESPONSE))).toBe(RESPONSE);
    expect(guardXml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(RESPONSE)]))).toBe(
      RESPONSE,
    );
    expect(guardXml(utf16le(RESPONSE))).toBe(RESPONSE);
    expect(guardXml(utf16be(RESPONSE, false))).toBe(RESPONSE);
    const declared = `<?xml version="1.0" encoding="UTF-16"?>${RESPONSE}`;
    expect(guardXml(utf16be(declared))).toBe(declared);
  });

  it.each([
    ['UTF-8', utf8(DTD + RESPONSE)],
    ['lower case', utf8(`<!doctype r>${RESPONSE}`)],
    ['after the declaration', utf8(`<?xml version="1.0"?>\n${DTD}${RESPONSE}`)],
    ['an entity alone', utf8(`${RESPONSE}<!ENTITY e "x">`)],
    ['UTF-16LE with a byte order mark', utf16le(DTD + RESPONSE)],
    ['UTF-16LE without one', utf16le(DTD + RESPONSE, false)],
    ['UTF-16BE with a byte order mark', utf16be(DTD + RESPONSE)],
    ['UTF-16BE without one', utf16be(DTD + RESPONSE, false)],
  ])('refuses a DTD in %s', (_, bytes) => {
    expect(refusal(() => guardXml(bytes))).toBe('dtd');
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['over the cap', Buffer.alloc(MAX_XML_BYTES + 1, 0x20)],
    ['invalid UTF-8', Buffer.from([0x3c, 0x61, 0xc3, 0x28, 0x3e])],
    ['an odd UTF-16 length', Buffer.concat([utf16le(RESPONSE), Buffer.from([0x3c])])],
    ['UTF-32', Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), utf16le(RESPONSE, false)])],
    ['a NUL character', utf8(`${RESPONSE}\0`)],
    ['UTF-7 declared', utf8(`<?xml version="1.0" encoding="UTF-7"?>+ADw-!DOCTYPE r+AD4-`)],
    ['UTF-8 declared in UTF-16', utf16le(`<?xml version="1.0" encoding="utf-8"?>${RESPONSE}`)],
  ])('refuses %s as malformed', (_, bytes) => {
    expect(refusal(() => guardXml(bytes))).toBe('malformed');
  });

  it('allows a document of exactly the cap', () => {
    const padded = RESPONSE + ' '.repeat(MAX_XML_BYTES - RESPONSE.length);
    expect(guardXml(utf8(padded))).toBe(padded);
  });
});

describe('decodeSamlResponse', () => {
  const posted = utf8(RESPONSE).toString('base64');

  it('decodes strict base64, with the line breaks some providers add', () => {
    expect(decodeSamlResponse(posted)).toBe(RESPONSE);
    expect(decodeSamlResponse(posted.replace(/(.{76})/g, '$1\r\n'))).toBe(RESPONSE);
  });

  it('refuses a DTD inside the base64', () => {
    expect(refusal(() => decodeSamlResponse(utf16le(DTD + RESPONSE).toString('base64')))).toBe(
      'dtd',
    );
  });

  it.each([
    ['empty', ''],
    ['URL-safe characters', utf8(`${RESPONSE}??>`).toString('base64url')],
    ['missing padding', posted.replace(/=+$/, '')],
    ['padding in the middle', `${posted.slice(0, 4)}=${posted.slice(5)}`],
    ['non-zero spare bits', 'PHg+PC94Pj=='],
  ])('refuses %s', (_, value) => {
    expect(refusal(() => decodeSamlResponse(value))).toBe('malformed');
  });
});
