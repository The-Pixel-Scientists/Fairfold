// SPDX-License-Identifier: AGPL-3.0-or-later

import { getSettings, timeZones, updateSettings } from '@pixel-scientists/domain/platform/settings';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Select,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { useTenantLook } from './look.tsx';
import { SettingsCard, SettingsFrame, WhenLoaded } from './SettingsFrame.tsx';
import { useLoad } from './useLoad.ts';

const FIELDS = ['name', 'timeZone', 'fiscalYearStartMonth'] as const;

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Made once, since a drop-down of every time zone is slow to build again on each key pressed. */
const zoneOptions = timeZones.map((zone) => (
  <option key={zone} value={zone}>
    {zone}
  </option>
));

interface Saved {
  name: string;
  timeZone: string;
  fiscalYearStartMonth: number;
}

function GeneralForm({ initial }: { initial: Saved }) {
  const { refresh } = useTenantLook();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [month, setMonth] = useState(String(initial.fiscalYearStartMonth));
  const [done, setDone] = useState(false);

  const dirty =
    name !== saved.name ||
    timeZone !== saved.timeZone ||
    month !== String(saved.fiscalYearStartMonth);
  useLeaveGuard(dirty);

  const form = useSubmit(FIELDS, async () => {
    const result = await callApi(updateSettings, {
      body: { name, timeZone, fiscalYearStartMonth: Number(month) },
    });
    setSaved(result);
    setName(result.name);
    setTimeZone(result.timeZone);
    setMonth(String(result.fiscalYearStartMonth));
    setDone(true);
    // The header shows the new name; if it cannot be read now, the next page load shows it.
    await refresh().catch(() => undefined);
  });

  function edit(change: () => void) {
    setDone(false);
    change();
  }

  return (
    <SettingsCard title="Funder details">
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField
          id="name"
          label="Funder name"
          hint="Staff and applicants see this name."
          error={form.errorFor('name')}
        >
          <Input
            name="name"
            value={name}
            autoComplete="organization"
            onChange={(event) => {
              edit(() => {
                setName(event.target.value);
              });
            }}
          />
        </FormField>
        <FormField
          id="timeZone"
          label="Time zone"
          hint="Dates and deadlines use this time zone."
          error={form.errorFor('timeZone')}
        >
          <Select
            name="timeZone"
            value={timeZone}
            onChange={(event) => {
              edit(() => {
                setTimeZone(event.target.value);
              });
            }}
          >
            {/* A stored zone this browser does not list still shows as chosen. */}
            {!timeZones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
            {zoneOptions}
          </Select>
        </FormField>
        <FormField
          id="fiscalYearStartMonth"
          label="Financial year starts in"
          error={form.errorFor('fiscalYearStartMonth')}
        >
          <Select
            name="fiscalYearStartMonth"
            value={month}
            onChange={(event) => {
              edit(() => {
                setMonth(event.target.value);
              });
            }}
          >
            {months.map((label, index) => (
              <option key={label} value={String(index + 1)}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save settings
          </Button>
          <p role="status" className="text-body font-medium text-success">
            {done && 'Settings saved.'}
          </p>
        </div>
      </form>
    </SettingsCard>
  );
}

const loadSettings = () => callApi(getSettings, {});

function General() {
  const { state, retry } = useLoad(loadSettings);
  return (
    <WhenLoaded state={state} label="Loading settings" retry={retry}>
      {(settings) => <GeneralForm initial={settings} />}
    </WhenLoaded>
  );
}

/** The funder's name, time zone and financial year. */
export default function GeneralPage() {
  return (
    <SettingsFrame title="General settings">
      <General />
    </SettingsFrame>
  );
}
