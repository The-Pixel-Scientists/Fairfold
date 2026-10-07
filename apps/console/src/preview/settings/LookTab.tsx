// SPDX-License-Identifier: AGPL-3.0-or-later

import { presetLabels, presets } from '@pixel-scientists/domain/platform';
import type { Preset } from '@pixel-scientists/domain/platform';
import { themeProperties } from '@pixel-scientists/domain/platform/settings';
import {
  Button,
  FormField,
  Input,
  Panel,
  RadioGroup,
  TenantLogo,
  buttonClassName,
  useColourScheme,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { Icon } from '../decide/parts.tsx';
import { funder } from '../story.ts';

/** The standard ink, which passes the contrast check. */
const BRAND_COLOUR = '#1b1d21';

const presetHints: Record<Preset, string> = {
  standard: 'Small rounded corners on a soft paper page.',
  rounded: 'Larger rounded corners on a warmer page.',
  square: 'Square corners on a neutral grey page.',
};

const presetOptions = presets.map((value) => ({
  value,
  label: presetLabels[value],
  hint: presetHints[value],
}));

/**
 * A header, a current page, buttons and a link in the chosen look, drawn from
 * the same properties the funder's theme.css sets. It is a picture of the
 * look, not controls.
 */
function LookPreview({ preset }: { preset: Preset }) {
  const scheme = useColourScheme();
  const { light, dark } = themeProperties({ brandColour: BRAND_COLOUR, preset });
  return (
    <div
      aria-hidden="true"
      inert
      style={Object.fromEntries(scheme === 'dark' ? [...light, ...dark] : light)}
      className="overflow-hidden rounded-lg border border-divider bg-canvas text-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-surface px-gutter py-2">
        <TenantLogo slug={funder.slug} name={funder.name} hasLogo={false} />
        <span className="rounded-md bg-accent-soft px-control-x py-1 text-body font-semibold text-accent underline decoration-2 underline-offset-4">
          Programmes
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 p-gutter">
        <span className={buttonClassName('primary')}>Save programme</span>
        <span className={buttonClassName('secondary')}>Cancel</span>
        <span className="text-body text-accent underline">View programme</span>
      </div>
    </div>
  );
}

/** The funder's brand colour, preset and logo, with a preview. */
export function LookTab() {
  const [preset, setPreset] = useState<Preset>('standard');

  return (
    <div className="flex flex-col gap-stack">
      <Panel title="Brand colour and preset">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
          }}
          className="flex flex-col gap-4"
        >
          <FormField
            label="Brand colour"
            hint="A hex code, like #1f4bb8. It colours buttons, links and the current page."
          >
            <div className="flex items-center gap-2">
              <Input
                name="brandColour"
                defaultValue={BRAND_COLOUR}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="max-w-40 font-mono"
              />
              <input
                type="color"
                aria-label="Choose a colour"
                defaultValue={BRAND_COLOUR}
                className="h-control w-12 shrink-0 cursor-pointer rounded-md border border-edge bg-surface p-1"
              />
            </div>
            <p role="status" className="flex items-center gap-1.5 text-body text-success">
              <Icon name="check" />
              This colour passes the contrast check.
            </p>
          </FormField>
          <RadioGroup
            legend="Preset"
            name="preset"
            value={preset}
            options={presetOptions}
            onValueChange={(value) => {
              setPreset(value as Preset);
            }}
          />
          <div className="flex flex-col gap-2">
            <h3 className="text-body font-medium text-ink">Preview</h3>
            <LookPreview preset={preset} />
          </div>
          <div>
            <Button type="submit" variant="primary">
              Save look
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title="Logo">
        <div className="flex flex-col gap-2">
          <p className="text-body text-muted">
            You have no logo yet, so your name shows in the header.
          </p>
          <div className="rounded-md border border-divider bg-surface p-3">
            <TenantLogo slug={funder.slug} name={funder.name} hasLogo={false} />
          </div>
        </div>
        <FormField
          label="Logo file"
          hint="A PNG or WebP image of 200 KB or less, no larger than 1200 by 400 pixels."
        >
          <Input name="logo" type="file" accept="image/png,image/webp" />
        </FormField>
        <div>
          <Button>Upload logo</Button>
        </div>
      </Panel>
    </div>
  );
}
