// SPDX-License-Identifier: AGPL-3.0-or-later

import { moduleIds } from '@pixel-scientists/domain/platform';
import { Button, FormField, Input, Select, useLoad } from '@pixel-scientists/ui';
import { useId, useState } from 'react';
import type { ChangeEvent, SyntheticEvent } from 'react';

import { actionOptions, entityTypeOptions } from './actions.ts';
import { loadMembers } from './loaders.ts';
import { draftOf, filtersFrom, isFiltered } from './query.ts';
import type { AuditFilters, Draft, FilterKey } from './query.ts';
import { moduleLabel } from './words.ts';

interface FiltersProps {
  filters: AuditFilters;
  /** Called with filters that have passed the contract's checks. */
  onApply: (filters: AuditFilters) => void;
  onClear: () => void;
}

/**
 * The log's filters, a form: nothing changes until "Apply filters", and the
 * applied filters go in the address. The page remounts it for each address, so
 * Back brings the earlier filters into the fields.
 */
export function Filters({ filters, onApply, onClear }: FiltersProps) {
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const [errors, setErrors] = useState<Partial<Record<FilterKey, string>>>({});
  const members = useLoad(loadMembers);
  const people = members.state.status === 'ready' ? members.state.value : null;
  const fieldId = (key: FilterKey) => `${prefix}-${key}`;

  const set = (key: FilterKey, value: string) => {
    setDraft((now) => ({ ...now, [key]: value }));
  };
  const choose = (key: FilterKey) => ({
    value: draft[key],
    onChange: (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      set(key, event.currentTarget.value);
    },
  });

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    const result = filtersFrom(draft);
    if (result.ok) {
      setErrors({});
      onApply(result.filters);
      return;
    }
    setErrors(result.errors);
    const first = (Object.keys(result.errors) as FilterKey[])[0];
    if (first !== undefined) document.getElementById(fieldId(first))?.focus();
  }

  const note =
    members.state.status === 'loading'
      ? 'Loading the team'
      : people === null
        ? 'The team did not load'
        : null;
  const listed = people?.some(({ id }) => id === draft.byMembershipId) ?? false;

  return (
    <form
      role="search"
      aria-label="Filter the audit log"
      onSubmit={submit}
      noValidate
      className="grid items-end gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <FormField label="Module" id={fieldId('module')} error={errors.module}>
        <Select
          {...choose('module')}
          onChange={(event) => {
            // An action or entity type of another module cannot match, so changing the module clears them.
            const module = event.currentTarget.value;
            setDraft((now) => ({ ...now, module, action: '', entityType: '' }));
          }}
        >
          <option value="">Any</option>
          {moduleIds.map((id) => (
            <option key={id} value={id}>
              {moduleLabel(id)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Action" id={fieldId('action')} error={errors.action}>
        <Select {...choose('action')}>
          <option value="">Any</option>
          {actionOptions(draft.module, draft.action).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Entity type" id={fieldId('entityType')} error={errors.entityType}>
        <Select {...choose('entityType')}>
          <option value="">Any</option>
          {entityTypeOptions(draft.module, draft.entityType).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Entity ID" id={fieldId('entityId')} error={errors.entityId}>
        <Input
          {...choose('entityId')}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </FormField>
      <FormField label="Person" id={fieldId('byMembershipId')} error={errors.byMembershipId}>
        <Select
          {...choose('byMembershipId')}
          disabled={note !== null && draft.byMembershipId === ''}
        >
          <option value="">{note ?? 'Anyone'}</option>
          {people?.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name ?? member.email}
            </option>
          ))}
          {draft.byMembershipId !== '' && !listed && (
            <option value={draft.byMembershipId}>Selected person</option>
          )}
        </Select>
      </FormField>
      <FormField label="From" id={fieldId('from')} error={errors.from}>
        <Input type="date" {...choose('from')} />
      </FormField>
      <FormField label="To" id={fieldId('to')} error={errors.to}>
        <Input type="date" {...choose('to')} />
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        {isFiltered(filters) && (
          <Button variant="quiet" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}
