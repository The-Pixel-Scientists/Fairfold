// SPDX-License-Identifier: AGPL-3.0-or-later

import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, messages } from '@pixel-scientists/domain/platform';
import { removeLogo, uploadLogo } from '@pixel-scientists/domain/platform/settings';
import type { ThemeTokens } from '@pixel-scientists/domain/platform/settings';
import {
  Button,
  FormField,
  Input,
  TenantLogo,
  asProblem,
  useLeaveGuard,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { callApi } from '../../api.ts';
import { useTenantSlug } from '../../tenant.ts';
import { readLogo } from './logo.ts';
import type { ChosenLogo } from './logo.ts';
import { useTenantLook } from './look.tsx';
import { SettingsCard } from './SettingsFrame.tsx';

export interface LogoSectionProps {
  theme: ThemeTokens;
  name: string;
  onChanged: (theme: ThemeTokens) => void;
}

/** The words for a refused upload or removal: the API's for the file, or for the whole request. */
function refusal(error: unknown): string {
  const problem = asProblem(error);
  return problem?.errors[0]?.message ?? problem?.detail ?? messages.serviceFailed;
}

/** The funder's logo: what it is now, and a PNG or WebP file to replace it with, or to remove it. */
export function LogoSection({ theme, name, onChanged }: LogoSectionProps) {
  const slug = useTenantSlug();
  const { refresh, version } = useTenantLook();
  const [chosen, setChosen] = useState<ChosenLogo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useLeaveGuard(
    chosen !== null,
    'You chose a logo but have not uploaded it. If you leave this page, you will lose it.',
  );

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setDone(null);
    setProblem(null);
    setChosen(null);
    if (file === undefined) return;
    const read = await readLogo(file);
    if ('message' in read) setProblem(read.message);
    else setChosen(read);
  }

  async function change(action: () => Promise<ThemeTokens>, saved: string) {
    if (pending) return;
    setPending(true);
    setProblem(null);
    setDone(null);
    try {
      onChanged(await action());
      setChosen(null);
      if (picker.current) picker.current.value = '';
      setDone(saved);
      await refresh().catch(() => undefined);
    } catch (error) {
      setProblem(refusal(error));
      picker.current?.focus();
    } finally {
      setPending(false);
    }
  }

  function upload() {
    if (chosen === null) {
      // A file that was refused already has its own words.
      setProblem((earlier) => earlier ?? messages.logoType);
      picker.current?.focus();
      return;
    }
    void change(() => callApi(uploadLogo, { body: { data: chosen.data } }), 'Logo saved.');
  }

  function remove() {
    // The button that was pressed goes with the logo, so focus moves to where a new one is chosen.
    picker.current?.focus();
    void change(() => callApi(removeLogo, {}), 'Logo removed.');
  }

  return (
    <SettingsCard title="Logo">
      <div className="flex flex-col gap-2">
        <p className="text-body text-muted">
          {theme.hasLogo
            ? 'This is your logo. It shows in the header beside your name.'
            : 'You have no logo yet, so your name shows in the header.'}
        </p>
        <div className="rounded-md border border-divider bg-surface p-3">
          <TenantLogo slug={slug} name={name} hasLogo={theme.hasLogo} version={version} />
        </div>
      </div>
      <FormField
        id="logo"
        label="Logo file"
        hint={`A PNG or WebP image of 200 KB or less, no larger than ${String(LOGO_MAX_WIDTH)} by ${String(LOGO_MAX_HEIGHT)} pixels.`}
        error={problem ?? undefined}
      >
        <Input
          ref={picker}
          name="logo"
          type="file"
          accept="image/png,image/webp"
          onChange={(event) => {
            void choose(event);
          }}
        />
      </FormField>
      <p role="status" className="text-body text-ink">
        {problem !== null && <span className="sr-only">{problem}</span>}
        {chosen !== null &&
          `Ready to upload: ${chosen.name}, ${String(chosen.width)} by ${String(chosen.height)} pixels.`}
        {done !== null && <span className="font-medium text-success">{done}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" aria-disabled={pending || undefined} onClick={upload}>
          Upload logo
        </Button>
        {theme.hasLogo && (
          <Button aria-disabled={pending || undefined} onClick={remove}>
            Remove logo
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
