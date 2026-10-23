// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import type { PublisherSetting } from '../../contracts/index.ts';
import { savePublisher } from './loaders.ts';

const FIELDS = ['funderIdentifier', 'funderName', 'identifierPrefix'] as const;

type Draft = Record<(typeof FIELDS)[number], string>;

const draftOf = (saved: PublisherSetting | null): Draft => ({
  funderIdentifier: saved?.funderIdentifier ?? '',
  funderName: saved?.funderName ?? '',
  identifierPrefix: saved?.identifierPrefix ?? '',
});

export interface PublisherFormProps {
  saved: PublisherSetting | null;
  onSaved: (saved: PublisherSetting) => void;
}

/** The funder's details as every 360Giving file prints them. They are public, so nothing here is private. */
export function PublisherForm({ saved, onSaved }: PublisherFormProps) {
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [done, setDone] = useState(false);
  const was = draftOf(saved);
  useLeaveGuard(FIELDS.some((field) => draft[field] !== was[field]));

  const form = useSubmit(FIELDS, async () => {
    const result = await savePublisher(draft);
    setDraft(draftOf(result));
    setDone(true);
    onSaved(result);
  });

  function field(name: (typeof FIELDS)[number]) {
    return {
      name,
      value: draft[name],
      onChange: (event: { target: { value: string } }) => {
        setDone(false);
        setDraft({ ...draft, [name]: event.target.value });
      },
    };
  }

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-4">
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField
        id="funderIdentifier"
        label="Funder identifier"
        hint="Find yours on org-id.guide. For example, GB-CHC-1234567 for a registered charity."
        error={form.errorFor('funderIdentifier')}
      >
        <Input {...field('funderIdentifier')} autoComplete="off" spellCheck={false} />
      </FormField>
      <FormField
        id="funderName"
        label="Funder name"
        hint="The name to publish. For example, Northfield Foundation."
        error={form.errorFor('funderName')}
      >
        <Input {...field('funderName')} autoComplete="organization" />
      </FormField>
      <FormField
        id="identifierPrefix"
        label="Grant identifier prefix"
        hint="The prefix 360Giving gave you, starting 360G-. For example, 360G-northfield."
        error={form.errorFor('identifierPrefix')}
      >
        <Input {...field('identifierPrefix')} autoComplete="off" spellCheck={false} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          Save publisher details
        </Button>
        <p role="status" className="text-body font-medium text-success">
          {done && 'Publisher details saved.'}
        </p>
      </div>
    </form>
  );
}
