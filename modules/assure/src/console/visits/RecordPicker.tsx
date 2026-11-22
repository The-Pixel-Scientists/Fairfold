// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chooses a record from the platform search, so a visit never holds an id
// someone typed. The term goes in the request body and is never kept.

import {
  SEARCH_TERM_MIN_CHARACTERS,
  normaliseSearchTerm,
} from '@pixel-scientists/domain/platform/search';
import { Combobox, asProblem } from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { findRecords } from '../loaders.ts';

export interface Found {
  id: string;
  label: string;
}

interface Outcome {
  term: string;
  found: readonly Found[];
  status: string;
}

const DEBOUNCE_MS = 250;

export function RecordPicker({
  label,
  hint,
  module,
  kind,
  onPick,
}: {
  label: string;
  hint: string;
  module: 'crm' | 'grants';
  kind: string;
  onPick: (record: Found) => void;
}) {
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const term = normaliseSearchTerm(value);
  const ready = term.length >= SEARCH_TERM_MIN_CHARACTERS;

  useEffect(() => {
    if (!ready) return;
    let current = true;
    const timer = setTimeout(() => {
      findRecords(term, module, kind).then(
        (found) => {
          if (current) {
            setOutcome({
              term,
              found,
              status: found.length === 0 ? 'No matches.' : `${String(found.length)} found.`,
            });
          }
        },
        (error: unknown) => {
          if (current) {
            setOutcome({
              term,
              found: [],
              status: asProblem(error)?.detail ?? 'The search failed. Try again.',
            });
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, ready, module, kind]);

  const shown = ready && outcome?.term === term ? outcome : null;
  return (
    <Combobox
      label={label}
      hint={hint}
      value={value}
      onValueChange={setValue}
      groups={[{ id: kind, label, options: shown?.found ?? [] }]}
      loading={ready && shown === null}
      status={shown?.status ?? ''}
      onSelect={(id) => {
        const chosen = shown?.found.find((record) => record.id === id);
        if (chosen === undefined) return;
        onPick(chosen);
        setValue('');
      }}
    />
  );
}
