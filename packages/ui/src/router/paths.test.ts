// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  InvalidAppPathError,
  assertAppPath,
  isAppPath,
  matchPath,
  normalizeBasePath,
  resolveAppPath,
  searchToRecord,
} from './paths.ts';

describe('isAppPath', () => {
  it('accepts paths inside the app', () => {
    for (const path of ['/', '/applications', '/applications/42?tab=notes#history', '/a%20b']) {
      expect(isAppPath(path), path).toBe(true);
    }
  });

  it('refuses anything that could leave the app', () => {
    const crafted = [
      '',
      'applications',
      '//evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'http:evil.example',
      'javascript:alert(1)',
      'data:text/html,hello',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/ /evil.example',
      '/\u0000',
      '/\u007f',
      // Dot segments, which the URL parser resolves into //evil.example.
      '/..//evil.example',
      '/.//evil.example',
      '/%2e%2e//evil.example',
      '/%2E%2e//evil.example',
      '/a/..//evil.example',
      '/a/.%2E//evil.example',
      '/a/../b?next=1',
      '/.',
    ];
    for (const path of crafted) {
      expect(isAppPath(path), JSON.stringify(path)).toBe(false);
    }
  });
});

describe('assertAppPath', () => {
  it('returns a good path unchanged', () => {
    expect(assertAppPath('/applications')).toBe('/applications');
  });

  it('throws InvalidAppPathError for a bad one, without repeating it', () => {
    expect(() => assertAppPath('//evil.example')).toThrow(InvalidAppPathError);
    expect(() => assertAppPath('//evil.example')).not.toThrow('evil.example');
    expect(() => assertAppPath('/..//evil.example')).toThrow(InvalidAppPathError);
  });
});

describe('resolveAppPath', () => {
  it('returns the parsed address and an href that starts with the base path', () => {
    expect(resolveAppPath('', '/applications/42?tab=notes#history')).toEqual({
      location: { pathname: '/applications/42', search: '?tab=notes', hash: '#history' },
      href: '/applications/42?tab=notes#history',
    });
    expect(resolveAppPath('/console', '/').href).toBe('/console/');
  });

  it('refuses a path that climbs out of the base path', () => {
    expect(() => resolveAppPath('/console', '/../portal')).toThrow(InvalidAppPathError);
    expect(() => resolveAppPath('/console', '/%2e%2e/portal')).toThrow(InvalidAppPathError);
  });

  it('refuses the crafted paths, and never repeats them in the message', () => {
    const crafted = ['/..//evil.example', '/.//evil.example', '/%2e%2e//evil.example'];
    for (const to of [...crafted, '/a/..//evil.example']) {
      expect(() => resolveAppPath('', to), to).toThrow(InvalidAppPathError);
      expect(() => resolveAppPath('', to), to).not.toThrow('evil.example');
    }
  });
});

describe('normalizeBasePath', () => {
  it('treats nothing, or only slashes, as the root', () => {
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
  });

  it('drops a trailing slash', () => {
    expect(normalizeBasePath('/console/')).toBe('/console');
  });

  it('refuses a base that is not an app path', () => {
    expect(() => normalizeBasePath('//evil.example')).toThrow(InvalidAppPathError);
    expect(() => normalizeBasePath('console')).toThrow(InvalidAppPathError);
  });
});

describe('matchPath', () => {
  it('matches a static path', () => {
    expect(matchPath('/applications', '/applications')).toEqual({});
    expect(matchPath('/', '/')).toEqual({});
  });

  it('ignores a trailing slash', () => {
    expect(matchPath('/applications', '/applications/')).toEqual({});
  });

  it('captures and decodes parameters', () => {
    expect(matchPath('/applications/:id/notes/:noteId', '/applications/a%20b/notes/7')).toEqual({
      id: 'a b',
      noteId: '7',
    });
  });

  it('does not match a different path, or a different length', () => {
    expect(matchPath('/applications', '/programmes')).toBeNull();
    expect(matchPath('/applications/:id', '/applications')).toBeNull();
    expect(matchPath('/applications', '/applications/42')).toBeNull();
  });

  it('does not match an address with broken percent-encoding', () => {
    expect(matchPath('/applications/:id', '/applications/%E0%A4%A')).toBeNull();
  });
});

describe('searchToRecord', () => {
  it('reads one value as a string and a repeated key as an array', () => {
    expect(searchToRecord('?stage=review&owner=a&owner=b')).toEqual({
      stage: 'review',
      owner: ['a', 'b'],
    });
  });

  it('reads an empty search as an empty record', () => {
    expect(searchToRecord('')).toEqual({});
  });

  it('drops keys that could reach an object prototype', () => {
    const record = searchToRecord('?__proto__=a&constructor=b&prototype=c&stage=review');
    expect(record).toEqual({ stage: 'review' });
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
