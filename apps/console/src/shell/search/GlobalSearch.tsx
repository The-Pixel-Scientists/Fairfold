// SPDX-License-Identifier: AGPL-3.0-or-later

import { call, ProblemError } from '@pixel-scientists/domain/api';
import { modules } from '@pixel-scientists/domain/platform';
import {
  normaliseSearchTerm,
  searchTerm,
  SEARCH_TERM_MAX_CHARACTERS,
  SEARCH_TERM_MIN_CHARACTERS,
} from '@pixel-scientists/domain/platform/search';
import type { SearchResponse } from '@pixel-scientists/domain/platform/search';
import { Combobox, hasPermission, useNavigate } from '@pixel-scientists/ui';
import type { ComboboxGroup, SessionData } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { retryAfterSeconds } from '../../api.ts';
import { consoleModules } from '../../modules.ts';
import { addressFor } from './addresses.ts';

const DEBOUNCE_MS = 250;
/** Groups in the order of the navigation; the party records come first. */
const GROUP_ORDER: readonly string[] = ['party', ...consoleModules.map(({ id }) => id)];

const apple = /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = apple ? 'Cmd+K' : 'Ctrl+K';

const plural = (count: number, one: string, other: string) =>
  `${String(count)} ${count === 1 ? one : other}`;

interface Outcome {
  term: string;
  groups: ComboboxGroup[];
  loading: boolean;
  status: string;
}

const NO_GROUPS: ComboboxGroup[] = [];

interface Hit {
  kind: string;
  id: string;
  label?: string;
  reference?: string;
}

/** The groups to show, as the server sent them: the navigation's order, and no result without a page. */
export function groupsFor(response: SearchResponse): ComboboxGroup[] {
  const groups: ComboboxGroup[] = [];
  for (const group of response.groups) {
    const options = (group.results as readonly Hit[]).flatMap((hit) => {
      const path = addressFor(hit.kind, hit.id);
      return path === null ? [] : [{ id: path, label: hit.reference ?? hit.label ?? '' }];
    });
    if (options.length === 0) continue;
    const { label } = modules[group.module];
    groups.push({
      id: group.module,
      label,
      options,
      ...(group.more ? { note: `More results in ${label}` } : {}),
    });
  }
  return groups.sort((a, b) => GROUP_ORDER.indexOf(a.id) - GROUP_ORDER.indexOf(b.id));
}

export function countMessage(groups: readonly ComboboxGroup[]): string {
  const results = groups.reduce((sum, group) => sum + group.options.length, 0);
  return results === 0
    ? 'No results for that search'
    : `${plural(results, 'result', 'results')} in ${plural(groups.length, 'tool', 'tools')}`;
}

function failureMessage(error: unknown, retryAfter: number | null): string {
  if (error instanceof ProblemError && error.status === 429) {
    return retryAfter === null
      ? 'Too many searches. Try again in a few seconds'
      : `Too many searches. Try again in ${plural(retryAfter, 'second', 'seconds')}`;
  }
  return 'The search did not run. Try again';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** What to say about a term that is too short or too long, or nothing for an empty box. */
function termProblem(term: string): string | null {
  if (term === '') return '';
  if (term.length < SEARCH_TERM_MIN_CHARACTERS) {
    return `Enter at least ${String(SEARCH_TERM_MIN_CHARACTERS)} characters`;
  }
  if (term.length > SEARCH_TERM_MAX_CHARACTERS) {
    return `Enter no more than ${String(SEARCH_TERM_MAX_CHARACTERS)} characters`;
  }
  return null;
}

/**
 * The header's search across tools. The term lives only in this component's
 * state and in the body of one POST at a time: it is never written to the
 * address, history or storage, and opening a result clears it.
 */
function SearchBox() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const term = normaliseSearchTerm(value);
  const problem = termProblem(term);
  // An answer belongs to the term it was asked for; once the term changes it is not shown.
  const current = problem === null && outcome?.term === term ? outcome : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(apple ? event.metaKey : event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (termProblem(term) !== null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      let retryAfter: number | null = null;
      setOutcome({ term, groups: [], loading: true, status: 'Searching' });
      call(
        searchTerm,
        { body: { term } },
        {
          fetch: async (url, init) => {
            const response = await fetch(url, { ...init, signal: controller.signal });
            if (response.status === 429) {
              retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
            }
            return response;
          },
        },
      )
        .then((response) => {
          const groups = groupsFor(response);
          setOutcome({ term, groups, loading: false, status: countMessage(groups) });
        })
        .catch((error: unknown) => {
          if (isAbort(error)) return;
          setOutcome({
            term,
            groups: [],
            loading: false,
            status: failureMessage(error, retryAfter),
          });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <div className="w-full min-w-0 sm:w-72">
      <Combobox
        label="Search"
        hint={`Organisations, people and applications. Shortcut: ${SHORTCUT}`}
        inputRef={input}
        value={value}
        onValueChange={setValue}
        groups={current?.groups ?? NO_GROUPS}
        loading={current?.loading ?? false}
        status={problem ?? current?.status ?? ''}
        onSelect={(path) => {
          setValue('');
          setOutcome(null);
          navigate(path);
        }}
      />
    </div>
  );
}

/** The search box, for a member who may use search; nothing for anyone else. */
export function GlobalSearch({ session }: { session: SessionData }) {
  return hasPermission(session, 'platform.search.use') ? <SearchBox /> : null;
}
