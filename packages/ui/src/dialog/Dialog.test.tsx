// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../Button.tsx';
import { Dialog } from './Dialog.tsx';
import { shareStyleNonce } from './nonce.ts';

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  delete (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__;
});

function Example({ onChange }: { onChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Switch funder
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onChange?.(next);
          setOpen(next);
        }}
        title="Switch funder"
        description="Choose the funder to work for."
        actions={
          <>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" data-autofocus>
              Switch to Northfield
            </Button>
          </>
        }
      >
        <label>
          Funder
          <input />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is a dialog with a name and a description, and nothing until it opens', async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Switch funder' }));

    const dialog = await screen.findByRole('dialog', { name: 'Switch funder' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog.textContent).toContain('Choose the funder to work for.');
    expect(screen.getByRole('heading', { level: 2, name: 'Switch funder' })).toBeTruthy();
  });

  it('puts focus on the control marked data-autofocus', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Switch funder' }));

    const primary = await screen.findByRole('button', { name: 'Switch to Northfield' });
    await waitFor(() => {
      expect(document.activeElement).toBe(primary);
    });
  });

  it('focuses the first control when none is marked', async () => {
    const user = userEvent.setup();
    function Plain() {
      return (
        <Dialog open onOpenChange={() => undefined} title="Rename">
          <input aria-label="Name" />
          <button type="button">Save name</button>
        </Dialog>
      );
    }
    render(<Plain />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save name' }));
  });

  it('keeps Tab inside the dialog, and hides the page behind it', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Switch funder' }));
    await screen.findByRole('dialog');

    for (let press = 0; press < 6; press += 1) {
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'Switch funder', hidden: false })).toBeNull();
  });

  it('closes on Escape and gives focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    const opener = screen.getByRole('button', { name: 'Switch funder' });
    await user.click(opener);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('asks its owner, which can keep it open', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onOpenChange={() => undefined} title="Stay here">
        <button type="button">Carry on</button>
      </Dialog>,
    );
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Stay here' })).toBeTruthy();
  });

  it('has no description, and so no aria-describedby, when none is given', async () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Rename">
        <input aria-label="Name" />
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Rename' });
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('shareStyleNonce', () => {
  it('hands the page nonce to the library that adds the scroll lock style', () => {
    document.head.innerHTML = '<meta property="csp-nonce" nonce="abc123" />';
    shareStyleNonce();
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBe('abc123');
  });

  it('leaves a page with no policy alone', () => {
    shareStyleNonce();
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBeUndefined();
  });

  it('is done when a dialog opens', async () => {
    document.head.innerHTML = '<meta property="csp-nonce" nonce="open-nonce" />';
    render(
      <Dialog open onOpenChange={() => undefined} title="Rename">
        <input aria-label="Name" />
      </Dialog>,
    );
    await screen.findByRole('dialog');
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBe('open-nonce');
  });
});
