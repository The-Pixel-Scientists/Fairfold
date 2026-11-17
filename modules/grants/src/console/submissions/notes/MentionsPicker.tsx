// SPDX-License-Identifier: AGPL-3.0-or-later

import { MAX_MENTIONS } from '@pixel-scientists/domain/notes';
import type { MemberName } from '@pixel-scientists/domain/notes';
import { Button, Combobox } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { nameOf } from './words.ts';

export interface MentionsPickerProps {
  /** Who may be mentioned, as the server lists them. Never built here. */
  members: readonly MemberName[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
  chosen: readonly MemberName[];
  onChange: (next: readonly MemberName[]) => void;
  /** Positions in `chosen` the server refused. */
  refused: ReadonlySet<number>;
}

/** Members to tell about a note, picked by name and sent as ids. */
export function MentionsPicker({
  members,
  loading,
  failed,
  retry,
  chosen,
  onChange,
  refused,
}: MentionsPickerProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const full = chosen.length >= MAX_MENTIONS;
  const picked = new Set(chosen.map((member) => member.membershipId));
  const needle = query.trim().toLowerCase();
  const options = members
    .filter(
      (member) =>
        !picked.has(member.membershipId) && nameOf(member.name).toLowerCase().includes(needle),
    )
    .map((member) => ({ id: member.membershipId, label: nameOf(member.name) }));

  const remove = (at: number) => {
    const gone = chosen[at];
    onChange(chosen.filter((_, index) => index !== at));
    setStatus(`${nameOf(gone?.name ?? null)} removed.`);
  };

  // Backspace in the empty box removes the last person. The listener is on the
  // wrapper, so the Combobox keeps its own keys and needs no new prop.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const inBox = (event.target as Element).getAttribute('role') === 'combobox';
      if (inBox && event.key === 'Backspace' && query === '' && chosen.length > 0) {
        event.preventDefault();
        remove(chosen.length - 1);
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
    };
  });

  return (
    <div ref={root} className="flex flex-col gap-2">
      <Combobox
        label="Mention people (optional)"
        hint="Only people who can see this application are listed. They will be told about the note."
        value={query}
        onValueChange={setQuery}
        loading={loading}
        groups={full || options.length === 0 ? [] : [{ id: 'members', label: 'People', options }]}
        status={
          full
            ? `You can mention up to ${String(MAX_MENTIONS)} people. Remove one to add another.`
            : status
        }
        onSelect={(id) => {
          const member = members.find((item) => item.membershipId === id);
          if (!member || picked.has(id) || full) return;
          onChange([...chosen, member]);
          setQuery('');
          setStatus(`${nameOf(member.name)} added.`);
        }}
      />
      {failed && (
        <p className="flex flex-wrap items-center gap-2 text-body text-danger">
          The list of people did not load.
          <Button onClick={retry}>Try loading people again</Button>
        </p>
      )}
      {chosen.length > 0 && (
        <ul aria-label="People mentioned" className="flex flex-wrap gap-2">
          {chosen.map((member, at) => (
            <li
              key={member.membershipId}
              className="flex flex-wrap items-center gap-1 rounded-full bg-sunken py-0.5 pr-1 pl-3 text-body text-ink"
            >
              <span className="[overflow-wrap:anywhere]">{nameOf(member.name)}</span>
              {refused.has(at) && (
                <span id={`refused-${member.membershipId}`} className="font-medium text-danger">
                  cannot see this application. Remove them to continue.
                </span>
              )}
              <Button
                variant="quiet"
                aria-describedby={refused.has(at) ? `refused-${member.membershipId}` : undefined}
                onClick={() => {
                  remove(at);
                }}
              >
                Remove<span className="sr-only"> {nameOf(member.name)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
