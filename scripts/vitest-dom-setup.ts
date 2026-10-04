// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Set-up for the ui Vitest project, before each test: stand-ins for the
// window methods jsdom lacks. window.scrollTo does nothing (jsdom's only
// reports that it is not implemented), and window.matchMedia matches no
// query, as for someone with no preferences set. A test may replace either;
// one that spies on them restores its spies itself.

import { beforeEach } from 'vitest';

interface MediaQueryListStandIn {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener(): void;
  removeEventListener(): void;
  addListener(): void;
  removeListener(): void;
  dispatchEvent(): boolean;
}

const { window } = globalThis as unknown as {
  window: {
    scrollTo: () => void;
    matchMedia: (query: string) => MediaQueryListStandIn;
  };
};

beforeEach(() => {
  window.scrollTo = () => undefined;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
});
