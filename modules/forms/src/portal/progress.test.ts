// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearProgress, keepKnown, loadProgress, saveProgress } from './progress.ts';
import { definition, FORM_ID, NEW_VERSION_ID, VERSION_ID } from './testing.tsx';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const keys = () => Object.keys(window.localStorage);

describe('local progress', () => {
  it('keeps answers under a key made only from the form id and version', () => {
    expect(saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' })).toBe(true);

    expect(keys()).toEqual([`form-progress:${FORM_ID}:${VERSION_ID}`]);
    const stored = JSON.parse(window.localStorage.getItem(keys()[0] ?? '') ?? '') as object;
    expect(stored).toEqual({ answers: { f_name: 'Sam' } });
  });

  it('restores them for the same version', () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' });

    expect(loadProgress(FORM_ID, VERSION_ID, definition)).toEqual({
      answers: { f_name: 'Sam' },
      restored: true,
      changed: false,
      dropped: 0,
      available: true,
    });
  });

  it('starts empty when nothing was kept', () => {
    expect(loadProgress(FORM_ID, VERSION_ID, definition)).toMatchObject({
      answers: {},
      restored: false,
      available: true,
    });
  });

  it('carries answers to a new version, keeps those it still asks and says how many went', () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam', f_gone: 'x' });

    const result = loadProgress(FORM_ID, NEW_VERSION_ID, definition);

    expect(result).toMatchObject({ answers: { f_name: 'Sam' }, changed: true, dropped: 1 });
    expect(keys()).toEqual([`form-progress:${FORM_ID}:${NEW_VERSION_ID}`]);
  });

  it('removes the entry when the answers are empty', () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' });
    saveProgress(FORM_ID, VERSION_ID, {});

    expect(keys()).toEqual([]);
  });

  it('clears every version of one form and no other', () => {
    saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' });
    saveProgress(FORM_ID, NEW_VERSION_ID, { f_name: 'Sam' });
    saveProgress('another-form', VERSION_ID, { f_name: 'Sam' });

    clearProgress(FORM_ID);

    expect(keys()).toEqual([`form-progress:another-form:${VERSION_ID}`]);
  });

  it('drops damaged entries instead of failing', () => {
    window.localStorage.setItem(`form-progress:${FORM_ID}:${VERSION_ID}`, '{not json');

    expect(loadProgress(FORM_ID, VERSION_ID, definition).answers).toEqual({});
    expect(keys()).toEqual([]);
  });

  it('never keeps an answer to a question the form does not ask', () => {
    expect(keepKnown(definition, { f_name: 'Sam', f_file: ['x'] })).toEqual({
      kept: { f_name: 'Sam' },
      dropped: 1,
    });
  });
});

describe('when the browser keeps nothing', () => {
  it('says so when storage cannot be reached', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    expect(loadProgress(FORM_ID, VERSION_ID, definition).available).toBe(false);
    expect(saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' })).toBe(false);
    expect(() => {
      clearProgress(FORM_ID);
    }).not.toThrow();
  });

  it('says so when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });

    expect(saveProgress(FORM_ID, VERSION_ID, { f_name: 'Sam' })).toBe(false);
  });
});
