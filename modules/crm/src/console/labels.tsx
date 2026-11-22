// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A record's name, read through the same routes as its page. Names are
// personal data: they are kept in memory for the page's life and nowhere else.

import type { PartyKind } from '@pixel-scientists/party/contracts';
import { Link } from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import { loadOrganisation, loadPerson, NOT_FOUND } from './loaders.ts';
import { organisationPath, personPath } from './paths.ts';
import { personName } from './words.ts';

const names = new Map<string, Promise<string>>();

async function readName(kind: PartyKind, id: string): Promise<string> {
  if (kind === 'organisation') {
    const record = await loadOrganisation(id);
    if (record === NOT_FOUND) return 'Record not available';
    return record.state === 'current' ? record.organisation.name : 'Merged record';
  }
  const record = await loadPerson(id);
  if (record === NOT_FOUND) return 'Record not available';
  if (record.state === 'erased') return 'Erased person';
  return record.state === 'current' ? personName(record.person) : 'Merged record';
}

/** The name, or null while it loads. A failed read says so, and a later read tries again. */
export function usePartyName(kind: PartyKind, id: string): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const cacheKey = `${kind}:${id}`;
    const read = names.get(cacheKey) ?? readName(kind, id);
    names.set(cacheKey, read);
    read.then(
      (value) => {
        if (current) setName(value);
      },
      () => {
        names.delete(cacheKey);
        if (current) setName('Name not available');
      },
    );
    return () => {
      current = false;
    };
  }, [kind, id]);
  return name;
}

/** A record's name as a link to its page. */
export function PartyLink({ kind, id }: { kind: PartyKind; id: string }) {
  const name = usePartyName(kind, id);
  if (name === null) return <span className="text-muted">Loading name</span>;
  return <Link to={kind === 'organisation' ? organisationPath(id) : personPath(id)}>{name}</Link>;
}

export const forgetNames = (): void => {
  names.clear();
};
