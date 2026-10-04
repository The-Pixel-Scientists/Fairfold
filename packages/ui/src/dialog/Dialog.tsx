// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog as Primitive } from 'radix-ui';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { shareStyleNonce } from './nonce.ts';

export interface DialogProps {
  open: boolean;
  /** Called with false when the person presses Escape or clicks outside. Close the dialog there, or keep it open. */
  onOpenChange: (open: boolean) => void;
  /** Names the dialog by what it is for, for example "Switch funder". */
  title: string;
  /** Says what the dialog asks. It is read out when the dialog opens. */
  description?: ReactNode;
  /** The form fields or other content. */
  children?: ReactNode;
  /** Buttons at the foot. Say what each does. Mark the one to focus first with `data-autofocus`. */
  actions?: ReactNode;
}

/** With no description, Radix must be told so, or it warns of a missing one. */
const noDescription = { 'aria-describedby': undefined } as const;

/**
 * A modal dialog. Focus moves into it when it opens, stays inside while it
 * is open, and goes back to where it was when it closes. Everything behind it
 * is hidden from assistive technology and cannot be reached. Escape closes
 * it. Focus lands on the first control, or on the one marked `data-autofocus`.
 * It has no animation, so there is nothing for reduced motion to switch off.
 */
export function Dialog({ open, onOpenChange, title, description, children, actions }: DialogProps) {
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    shareStyleNonce();
  }, [open]);

  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-50 bg-ink/50" />
        <Primitive.Content
          ref={content}
          {...(description === undefined ? noDescription : {})}
          onCloseAutoFocus={(event) => {
            // Radix gives focus back only to its own trigger, which a dialog opened from anywhere has not got.
            if (!(opener.current instanceof HTMLElement) || !opener.current.isConnected) return;
            event.preventDefault();
            opener.current.focus();
          }}
          onOpenAutoFocus={(event) => {
            const target = content.current?.querySelector<HTMLElement>('[data-autofocus]');
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-edge bg-surface p-gutter shadow-overlay"
        >
          <Primitive.Title className="text-lg font-semibold text-ink">{title}</Primitive.Title>
          {description !== undefined && (
            <Primitive.Description asChild>
              <div className="text-body text-muted">{description}</div>
            </Primitive.Description>
          )}
          {children}
          {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
