// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'colour-scheme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

type Listener = (event: Event) => void;

/**
 * A device whose colour scheme a test can change. Like a browser, matchMedia
 * gives a new list on every call, and a listener belongs to the list it was
 * added to.
 */
function stubDevice(initiallyDark = false) {
  let dark = initiallyDark;
  const lists: Set<Listener>[] = [];
  window.matchMedia = (query: string) => {
    const listeners = new Set<Listener>();
    lists.push(listeners);
    return {
      media: query,
      get matches() {
        return query === DARK_QUERY && dark;
      },
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    } as unknown as MediaQueryList;
  };
  return {
    setDark(next: boolean) {
      dark = next;
      for (const listeners of lists)
        for (const listener of listeners) listener(new Event('change'));
    },
    listening: () => lists.reduce((total, listeners) => total + listeners.size, 0),
  };
}

/** The module keeps the choice between renders, so each test loads its own copy. */
async function load() {
  vi.resetModules();
  const [{ ColourSchemeSwitch }, scheme] = await Promise.all([
    import('./ColourSchemeSwitch.tsx'),
    import('./colourScheme.ts'),
  ]);
  return { ColourSchemeSwitch, ...scheme };
}

const shown = () => document.documentElement.dataset['scheme'];
const stored = () => window.localStorage.getItem(KEY);
const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });
const checked = () =>
  screen
    .getAllByRole<HTMLInputElement>('radio')
    .filter((input) => input.checked)
    .map((input) => input.value);

/** Another tab changed the stored choice: the browser tells this one with a storage event. */
function anotherTabStores(value: string | null) {
  if (value === null) window.localStorage.removeItem(KEY);
  else window.localStorage.setItem(KEY, value);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: value }));
  });
}

/** Storage that refuses every call, as when a browser blocks it. */
function blockStorage() {
  const blocked = () => {
    throw new DOMException('Storage is blocked.', 'SecurityError');
  };
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(blocked);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset['scheme'];
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset['scheme'];
});

describe('ColourSchemeSwitch', () => {
  it('is a group named Appearance with Device, Light and Dark, and Device chosen', async () => {
    stubDevice();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    const group = screen.getByRole('group', { name: 'Appearance' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios).toEqual([radio('Device'), radio('Light'), radio('Dark')]);
    expect(radios.map((input) => input.value)).toEqual(['device', 'light', 'dark']);
    expect(new Set(radios.map((input) => input.name)).size).toBe(1);
    expect(radios[0]?.name).not.toBe('');
    expect(checked()).toEqual(['device']);
    expect(stored()).toBeNull();
  });

  it('shows the device scheme, and takes no choice from a device that is dark', async () => {
    stubDevice(true);
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    expect(shown()).toBe('dark');
    expect(checked()).toEqual(['device']);
    expect(stored()).toBeNull();
  });

  it('applies Dark and Light at once and keeps the choice', async () => {
    stubDevice();
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    expect(shown()).toBe('light');

    await user.click(radio('Dark'));
    expect(shown()).toBe('dark');
    expect(stored()).toBe('dark');
    expect(checked()).toEqual(['dark']);

    await user.click(radio('Light'));
    expect(shown()).toBe('light');
    expect(stored()).toBe('light');
    expect(checked()).toEqual(['light']);
  });

  it('chooses with the arrow keys once Tab has reached the group', async () => {
    stubDevice();
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    await user.tab();
    expect(document.activeElement).toBe(radio('Device'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(radio('Light'));
    expect(stored()).toBe('light');
    await user.keyboard('{ArrowRight}');
    expect(shown()).toBe('dark');
    expect(stored()).toBe('dark');
    expect(checked()).toEqual(['dark']);
  });

  it('starts from the choice already kept in this browser', async () => {
    stubDevice(true);
    const { ColourSchemeSwitch } = await load();
    window.localStorage.setItem(KEY, 'light');
    const { unmount } = render(<ColourSchemeSwitch />);
    expect(checked()).toEqual(['light']);
    expect(shown()).toBe('light');
    unmount();

    const again = await load();
    window.localStorage.setItem(KEY, 'dark');
    render(<again.ColourSchemeSwitch />);
    expect(checked()).toEqual(['dark']);
    expect(shown()).toBe('dark');
  });

  it('treats a stored value it does not know as Device', async () => {
    stubDevice();
    window.localStorage.setItem(KEY, 'sepia');
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    expect(checked()).toEqual(['device']);
    expect(shown()).toBe('light');
  });

  it('removes the kept choice for Device and follows the device from then on', async () => {
    const device = stubDevice(true);
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    await user.click(radio('Light'));
    expect(shown()).toBe('light');
    expect(stored()).toBe('light');

    await user.click(radio('Device'));
    expect(stored()).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(shown()).toBe('dark');
    expect(checked()).toEqual(['device']);

    act(() => {
      device.setDark(false);
    });
    expect(shown()).toBe('light');
  });

  it('shows a light device as light after Dark is chosen and then Device', async () => {
    stubDevice(false);
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    await user.click(radio('Dark'));
    await user.click(radio('Device'));

    expect(shown()).toBe('light');
    expect(stored()).toBeNull();
  });

  it('keeps two switches on the page in step', async () => {
    stubDevice();
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(
      <>
        <ColourSchemeSwitch />
        <ColourSchemeSwitch />
      </>,
    );

    await user.click(screen.getAllByRole('radio', { name: 'Dark' })[1] as HTMLElement);

    expect(
      screen
        .getAllByRole<HTMLInputElement>('radio', { name: 'Dark' })
        .map((input) => input.checked),
    ).toEqual([true, true]);
    expect(shown()).toBe('dark');
  });
});

describe('when storage is blocked', () => {
  it('starts on Device and still applies a choice for the page', async () => {
    stubDevice(false);
    blockStorage();
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    const { unmount } = render(<ColourSchemeSwitch />);

    expect(checked()).toEqual(['device']);
    expect(shown()).toBe('light');

    await user.click(radio('Dark'));
    expect(shown()).toBe('dark');
    expect(checked()).toEqual(['dark']);

    unmount();
    render(<ColourSchemeSwitch />);
    expect(checked()).toEqual(['dark']);
    expect(shown()).toBe('dark');

    await user.click(radio('Device'));
    expect(shown()).toBe('light');
    expect(checked()).toEqual(['device']);
  });

  it('does not throw from setSchemeChoice', async () => {
    stubDevice();
    blockStorage();
    const { setSchemeChoice } = await load();

    expect(() => {
      setSchemeChoice('dark');
    }).not.toThrow();
    expect(shown()).toBe('dark');
    expect(() => {
      setSchemeChoice('device');
    }).not.toThrow();
    expect(shown()).toBe('light');
  });
});

describe('another tab', () => {
  it('changes the switch and the page when it keeps a choice', async () => {
    stubDevice(false);
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    expect(checked()).toEqual(['device']);

    anotherTabStores('dark');
    expect(checked()).toEqual(['dark']);
    expect(shown()).toBe('dark');

    anotherTabStores('light');
    expect(checked()).toEqual(['light']);
    expect(shown()).toBe('light');
  });

  it('puts the switch back on Device when it removes the choice', async () => {
    stubDevice(true);
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    await user.click(radio('Light'));
    expect(shown()).toBe('light');

    anotherTabStores(null);

    expect(checked()).toEqual(['device']);
    expect(shown()).toBe('dark');
  });

  it('reads storage again when it clears everything', async () => {
    stubDevice(false);
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    await user.click(radio('Dark'));

    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });

    expect(checked()).toEqual(['device']);
    expect(shown()).toBe('light');
  });

  it('ignores a change to some other key', async () => {
    stubDevice(false);
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    window.localStorage.setItem(KEY, 'dark');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'dark' }));
    });

    expect(checked()).toEqual(['device']);
    expect(shown()).toBe('light');
  });
});

describe('the device', () => {
  it('changes the page while Device is chosen', async () => {
    const device = stubDevice(false);
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);
    expect(shown()).toBe('light');

    act(() => {
      device.setDark(true);
    });
    expect(shown()).toBe('dark');
    expect(checked()).toEqual(['device']);

    act(() => {
      device.setDark(false);
    });
    expect(shown()).toBe('light');
  });

  it('does not change a scheme the person chose', async () => {
    const device = stubDevice(false);
    const user = userEvent.setup();
    const { ColourSchemeSwitch } = await load();
    render(<ColourSchemeSwitch />);

    await user.click(radio('Light'));
    act(() => {
      device.setDark(true);
    });
    expect(shown()).toBe('light');

    await user.click(radio('Dark'));
    act(() => {
      device.setDark(false);
    });
    expect(shown()).toBe('dark');
  });

  it('is not listened to once nothing shows the switch', async () => {
    const device = stubDevice(false);
    const { ColourSchemeSwitch } = await load();
    const { unmount } = render(<ColourSchemeSwitch />);
    expect(device.listening()).toBeGreaterThan(0);

    unmount();

    expect(device.listening()).toBe(0);
  });
});

describe('useColourScheme', () => {
  async function loadShown() {
    const loaded = await load();
    function Shown() {
      return <p data-testid="shown">{loaded.useColourScheme()}</p>;
    }
    return { ...loaded, Shown };
  }
  const text = () => screen.getByTestId('shown').textContent;

  it('reports the scheme the page shows, and follows the device', async () => {
    const device = stubDevice(true);
    const { Shown } = await loadShown();
    render(<Shown />);
    expect(text()).toBe('dark');

    act(() => {
      device.setDark(false);
    });
    expect(text()).toBe('light');
  });

  it('follows a choice made with the switch', async () => {
    stubDevice(false);
    const user = userEvent.setup();
    const { ColourSchemeSwitch, Shown } = await loadShown();
    render(
      <>
        <ColourSchemeSwitch />
        <Shown />
      </>,
    );
    expect(text()).toBe('light');

    await user.click(radio('Dark'));
    expect(text()).toBe('dark');

    await user.click(radio('Light'));
    expect(text()).toBe('light');
  });

  it('follows setSchemeChoice and a choice kept by another tab', async () => {
    stubDevice(false);
    const { Shown, setSchemeChoice } = await loadShown();
    render(<Shown />);

    act(() => {
      setSchemeChoice('dark');
    });
    expect(text()).toBe('dark');

    anotherTabStores('light');
    expect(text()).toBe('light');
  });

  it('reports the choice, not the device, through useSchemeChoice', async () => {
    stubDevice(true);
    const { useSchemeChoice, setSchemeChoice } = await load();
    function Choice() {
      return <p data-testid="choice">{useSchemeChoice()}</p>;
    }
    render(<Choice />);
    expect(screen.getByTestId('choice').textContent).toBe('device');

    act(() => {
      setSchemeChoice('light');
    });
    expect(screen.getByTestId('choice').textContent).toBe('light');
    expect(shown()).toBe('light');
  });
});
