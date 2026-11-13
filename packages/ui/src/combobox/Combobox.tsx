// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';

import { cx } from '../cx.ts';
import { Input } from '../FormField.tsx';

export interface ComboboxOption {
  id: string;
  label: string;
  /** A second line, such as a reference. */
  secondary?: string;
}

export interface ComboboxGroup {
  id: string;
  /** The visible heading. */
  label: string;
  options: readonly ComboboxOption[];
  /** Plain text after the group's options. It is not an option. */
  note?: string;
}

export interface ComboboxProps {
  /** The visible label. */
  label: string;
  /** Shown under the label and read with the input, such as the shortcut. */
  hint?: string;
  value: string;
  onValueChange: (value: string) => void;
  groups: readonly ComboboxGroup[];
  /** Results are on their way. */
  loading?: boolean;
  /** One short line under the box, read out politely when it changes. */
  status?: string;
  onSelect: (optionId: string) => void;
  /** For moving focus into the box from elsewhere. */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * An editable combobox with a grouped list of options (WAI-ARIA 1.2, list
 * autocomplete). Focus stays in the input; the arrow keys move a highlight
 * across the groups, skipping their headings. It knows nothing of what the
 * options are: the caller supplies them and decides what opening one does.
 */
export function Combobox({
  label,
  hint,
  value,
  onValueChange,
  groups,
  loading = false,
  status,
  onSelect,
  inputRef,
}: ComboboxProps) {
  const base = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState({ groups, index: -1 });
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const flat = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  // A new set of results starts with nothing highlighted.
  const active = highlight.groups === groups ? highlight.index : -1;
  const setActive = (next: number | ((current: number) => number)) => {
    setHighlight({ groups, index: typeof next === 'function' ? next(active) : next });
  };
  const visible = open && flat.length > 0;
  const optionId = (index: number) => `${base}-option-${String(index)}`;
  const activeId = visible && active >= 0 ? optionId(active) : undefined;

  useEffect(() => {
    if (activeId !== undefined) {
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeId]);

  useEffect(() => {
    if (!visible) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, [visible]);

  const choose = (index: number) => {
    const option = flat[index];
    if (option) {
      setOpen(false);
      onSelect(option.id);
    }
  };

  // Clicks are heard on the list, so the options need no handlers of their own:
  // they are never focused, and the keyboard works through the input.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const keepFocus = (event: MouseEvent) => {
      event.preventDefault();
    };
    const pick = (event: MouseEvent) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (option) choose(Number(option.dataset['index']));
    };
    element.addEventListener('mousedown', keepFocus);
    element.addEventListener('click', pick);
    return () => {
      element.removeEventListener('mousedown', keepFocus);
      element.removeEventListener('click', pick);
    };
  });

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      if (!visible) {
        setOpen(true);
        setActive(event.key === 'ArrowDown' ? 0 : flat.length - 1);
      } else {
        setActive((current) =>
          event.key === 'ArrowDown'
            ? Math.min(current + 1, flat.length - 1)
            : Math.max(current - 1, 0),
        );
      }
    } else if (event.key === 'Enter' && visible && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      if (visible) {
        event.preventDefault();
        setOpen(false);
      } else if (value !== '') {
        event.preventDefault();
        onValueChange('');
      }
    }
  }

  const hintId = `${base}-hint`;
  const listId = `${base}-list`;
  let index = 0;

  return (
    <div ref={root} className="relative flex min-w-0 flex-col gap-1">
      <label htmlFor={`${base}-input`} className="text-body font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-body text-muted">
          {hint}
        </p>
      )}
      <Input
        ref={inputRef}
        id={`${base}-input`}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={hint ? hintId : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setOpen(true);
          onValueChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
        }}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-busy={loading}
        hidden={!visible}
        className="absolute top-full z-20 mt-1 max-h-80 w-full min-w-48 overflow-y-auto rounded-md border border-edge bg-surface py-1 shadow-lg"
      >
        {groups.map((group) => {
          const headingId = `${base}-group-${group.id}`;
          return (
            <div key={group.id} role="group" aria-labelledby={headingId}>
              <div
                id={headingId}
                role="presentation"
                className="px-3 py-1 text-body font-medium text-muted"
              >
                {group.label}
              </div>
              {group.options.map((option) => {
                const position = index++;
                return (
                  <div
                    key={option.id}
                    id={optionId(position)}
                    role="option"
                    aria-selected={position === active}
                    className={cx(
                      'flex min-h-target cursor-pointer flex-col border-l-4 border-transparent px-3 py-1 text-body text-ink',
                      'hover:bg-sunken aria-selected:border-accent aria-selected:bg-accent-soft aria-selected:font-medium',
                    )}
                    data-index={position}
                  >
                    <span className="[overflow-wrap:anywhere]">{option.label}</span>
                    {option.secondary && (
                      <span className="text-muted [overflow-wrap:anywhere]">
                        {option.secondary}
                      </span>
                    )}
                  </div>
                );
              })}
              {group.note && (
                <div role="presentation" className="px-3 py-1 text-body text-muted">
                  {group.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p role="status" className="min-h-6 text-body text-muted">
        {status}
      </p>
    </div>
  );
}
