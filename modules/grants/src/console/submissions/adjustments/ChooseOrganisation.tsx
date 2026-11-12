// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { listOrganisations } from '@pixel-scientists/party/contracts';
import { Button, Dialog, FormField, Input } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { problemLines } from '../../assessment/problems.ts';

export interface OrganisationChoice {
  id: string;
  name: string;
}

export interface ChooseOrganisationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChosen: (organisation: OrganisationChoice) => void;
}

/** Finds an organisation by name or identifier, for an adjustment that is not about one of its applications. */
export function ChooseOrganisation({ open, onOpenChange, onChosen }: ChooseOrganisationProps) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<OrganisationChoice[] | null>(null);
  const [failure, setFailure] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function find(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = search.trim();
    if (pending || text === '') return;
    setPending(true);
    setFailure([]);
    try {
      setFound((await call(listOrganisations, { query: { search: text } })).organisations);
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Choose an organisation"
      description="Search by name or by a charity or company number."
    >
      <form
        noValidate
        role="search"
        onSubmit={(event) => {
          void find(event);
        }}
        className="flex flex-col gap-3"
      >
        <FormField id="organisation-search" label="Organisation name or number">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
            }}
          />
        </FormField>
        <Button type="submit" className="self-start" aria-disabled={pending || undefined}>
          Search organisations
        </Button>
      </form>
      {failure.length > 0 && (
        <p role="alert" className="font-medium text-danger">
          {failure.join(' ')}
        </p>
      )}
      {found !== null && (
        <div role="status">
          {found.length === 0 ? (
            <p className="text-body text-muted">
              No organisation matches. Check the spelling, or search by number.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {found.map((organisation) => (
                <li key={organisation.id}>
                  <Button
                    className="w-full justify-start"
                    onClick={() => {
                      onChosen({ id: organisation.id, name: organisation.name });
                    }}
                  >
                    {organisation.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
