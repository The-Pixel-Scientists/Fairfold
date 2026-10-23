// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '../Button.tsx';
import { Dialog } from './Dialog.tsx';

export interface Shortcut {
  /** The keys to press together or in turn, each as it is labelled on a keyboard, such as "Shift" and "?". */
  keys: readonly string[];
  /** What happens, as a verb phrase: "Open the submission". */
  does: string;
}

export interface ShortcutGroup {
  /** Where they work, such as "In the table". */
  title: string;
  shortcuts: readonly Shortcut[];
}

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly ShortcutGroup[];
  /** Says where the shortcuts work, such as that a row of the table must have focus. */
  description?: string;
}

/**
 * The keyboard shortcuts of a screen, in groups. Open it from a visible
 * button as well as from a key, so it can be found without knowing the key.
 */
export function ShortcutsDialog({ open, onOpenChange, groups, description }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      {...(description === undefined ? {} : { description })}
      actions={
        <Button
          variant="primary"
          data-autofocus
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Close
        </Button>
      }
    >
      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-1">
          <h3 className="text-body font-semibold text-ink">{group.title}</h3>
          <dl className="flex flex-col divide-y divide-divider">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.does}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-baseline gap-x-4 py-1.5"
              >
                <dt className="flex flex-wrap items-center gap-1">
                  {shortcut.keys.map((key, index) => (
                    <kbd
                      key={`${String(index)}:${key}`}
                      className="rounded-sm border border-edge bg-sunken px-1.5 text-sm font-medium text-ink"
                    >
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="text-body text-ink">{shortcut.does}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}
