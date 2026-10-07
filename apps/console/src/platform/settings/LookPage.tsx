// SPDX-License-Identifier: AGPL-3.0-or-later

import { presetLabels, presets } from '@pixel-scientists/domain/platform';
import type { Preset } from '@pixel-scientists/domain/platform';
import { getTheme, updateTheme } from '@pixel-scientists/domain/platform/settings';
import type { ThemeTokens } from '@pixel-scientists/domain/platform/settings';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  RadioGroup,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { useTenantSlug } from '../../tenant.ts';
import { colourProblem, isHexColour } from './colour.ts';
import { LogoSection } from './LogoSection.tsx';
import { LookPreview } from './LookPreview.tsx';
import { useTenantLook } from './look.tsx';
import { SettingsCard, SettingsFrame, WhenLoaded } from './SettingsFrame.tsx';
import { useLoad } from './useLoad.ts';

const FIELDS = ['brandColour', 'preset'] as const;

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

function isPreset(value: string): value is Preset {
  return presets.some((preset) => preset === value);
}

interface LookFormProps {
  /** The look as it is saved. */
  theme: ThemeTokens;
  name: string;
  onSaved: (theme: ThemeTokens) => void;
}

function LookForm({ theme, name, onSaved }: LookFormProps) {
  const slug = useTenantSlug();
  const { refresh } = useTenantLook();
  const input = useRef<HTMLInputElement>(null);
  const [colour, setColour] = useState(theme.brandColour);
  const [preset, setPreset] = useState<Preset>(theme.preset);
  const [done, setDone] = useState(false);
  // The colour the API or the browser refused on the last attempt, so its words go once the colour changes.
  const [refused, setRefused] = useState<string | null>(null);

  const dirty = colour.toLowerCase() !== theme.brandColour || preset !== theme.preset;
  useLeaveGuard(dirty);

  const form = useSubmit(FIELDS, async () => {
    try {
      const saved = await callApi(updateTheme, { body: { brandColour: colour, preset } });
      onSaved(saved);
      setColour(saved.brandColour);
      setDone(true);
      setRefused(null);
      // The page takes the new look as soon as the funder's stylesheet is read again.
      await refresh().catch(() => undefined);
    } catch (error) {
      setRefused(colour);
      throw error;
    }
  });

  const refusal = refused === colour ? form.errorFor('brandColour') : undefined;
  const problem = colourProblem(colour, refusal);
  const passes = isHexColour(colour) && problem === null;
  const message = problem?.message ?? refusal;

  function edit(change: () => void) {
    setDone(false);
    change();
  }

  return (
    <SettingsCard title="Brand colour and preset">
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField
          id="brandColour"
          label="Brand colour"
          hint="A hex code, like #1f4bb8. It colours buttons, links and the current page."
          error={message}
        >
          <div className="flex items-center gap-2">
            <Input
              ref={input}
              name="brandColour"
              value={colour}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="max-w-40 font-mono"
              onChange={(event) => {
                edit(() => {
                  setColour(event.target.value.trim());
                });
              }}
            />
            <input
              type="color"
              aria-label="Choose a colour"
              value={isHexColour(colour) ? colour.toLowerCase() : theme.brandColour}
              onChange={(event) => {
                edit(() => {
                  setColour(event.target.value);
                });
              }}
              className="h-control w-12 shrink-0 cursor-pointer rounded-md border border-edge bg-surface p-1"
            />
          </div>
          <div role="status" className="flex flex-col items-start gap-2 text-body text-ink">
            {problem !== null && (
              <>
                <span className="sr-only">{problem.message}</span>
                <span>{problem.contrast}</span>
                {problem.suggestion !== null && (
                  <Button
                    onClick={() => {
                      edit(() => {
                        setColour(problem.suggestion ?? colour);
                      });
                      input.current?.focus();
                    }}
                  >
                    Use {problem.suggestion}
                  </Button>
                )}
              </>
            )}
            {passes && <span className="text-success">This colour passes the contrast check.</span>}
          </div>
        </FormField>
        <RadioGroup
          legend="Preset"
          name="preset"
          value={preset}
          options={presetOptions}
          error={form.errorFor('preset')}
          onValueChange={(value) => {
            if (isPreset(value)) {
              edit(() => {
                setPreset(value);
              });
            }
          }}
        />
        <div className="flex flex-col gap-2">
          <h3 className="text-body font-medium text-ink">Preview</h3>
          <LookPreview
            brandColour={passes ? colour.toLowerCase() : theme.brandColour}
            preset={preset}
            slug={slug}
            name={name}
            hasLogo={theme.hasLogo}
          />
          {!passes && (
            <p className="text-body text-muted">
              The preview keeps your saved colour until this one passes.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save look
          </Button>
          <p role="status" className="text-body font-medium text-success">
            {done && 'Look saved.'}
          </p>
        </div>
      </form>
    </SettingsCard>
  );
}

function LookEditor({ initial }: { initial: ThemeTokens }) {
  const slug = useTenantSlug();
  const { tenant } = useTenantLook();
  const [theme, setTheme] = useState(initial);

  return (
    <>
      <LookForm theme={theme} name={tenant?.name ?? slug} onSaved={setTheme} />
      <LogoSection theme={theme} name={tenant?.name ?? slug} onChanged={setTheme} />
    </>
  );
}

const loadTheme = () => callApi(getTheme, {});

function Look() {
  const { state, retry } = useLoad(loadTheme);
  return (
    <WhenLoaded state={state} label="Loading the look" retry={retry}>
      {(theme) => <LookEditor initial={theme} />}
    </WhenLoaded>
  );
}

/** The funder's brand colour, preset and logo, with a preview. */
export default function LookPage() {
  return (
    <SettingsFrame title="Look and logo">
      <Look />
    </SettingsFrame>
  );
}
