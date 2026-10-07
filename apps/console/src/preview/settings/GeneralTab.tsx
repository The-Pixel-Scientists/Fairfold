// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, FormField, Input, Panel, Select } from '@pixel-scientists/ui';

import { funder } from '../story.ts';

const zones = ['Europe/London', 'Europe/Dublin', 'Europe/Paris'];

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

/** The funder's name, time zone and financial year. */
export function GeneralTab() {
  return (
    <Panel title="Funder details">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="flex flex-col gap-4"
      >
        <FormField label="Funder name" hint="Staff and applicants see this name.">
          <Input name="name" defaultValue={funder.name} autoComplete="organization" />
        </FormField>
        <FormField label="Time zone" hint="Dates and deadlines use this time zone.">
          <Select name="timeZone" defaultValue="Europe/London">
            {zones.map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Financial year starts in">
          <Select name="fiscalYearStartMonth" defaultValue="4">
            {months.map((month, index) => (
              <option key={month} value={String(index + 1)}>
                {month}
              </option>
            ))}
          </Select>
        </FormField>
        <div>
          <Button type="submit" variant="primary">
            Save settings
          </Button>
        </div>
      </form>
    </Panel>
  );
}
