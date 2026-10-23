// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages, presetLabels } from '@pixel-scientists/domain/platform';
import type { TokenSet } from '@pixel-scientists/domain/platform';
import { removeThemeTokens, updateThemeTokens } from '@pixel-scientists/domain/platform/settings';
import type { ThemeSettings } from '@pixel-scientists/domain/platform/settings';
import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  asProblem,
  useLeaveGuard,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { callApi } from '../../api.ts';
import { useTenantSlug } from '../../tenant.ts';
import { LookPreview } from './LookPreview.tsx';
import { useTenantLook } from './look.tsx';
import { SettingsCard } from './SettingsFrame.tsx';
import {
  currentStylesheet,
  downloadText,
  readStylesheet,
  stylesheetFileName,
} from './stylesheet.ts';

export interface StylesheetSectionProps {
  theme: ThemeSettings;
  name: string;
  onChanged: (theme: ThemeSettings) => void;
}

const NO_FILE = 'Choose a stylesheet to save.';

/** The words for a refused removal: the API's for the request. */
const refusal = (error: unknown) => asProblem(error)?.detail ?? messages.serviceFailed;

/**
 * The funder's own stylesheet: download the current look as one, read an
 * edited file with every problem listed by line, preview it in both colour
 * schemes, save it, or go back to a preset (ADR 0046).
 */
export function StylesheetSection({ theme, name, onChanged }: StylesheetSectionProps) {
  const slug = useTenantSlug();
  const { refresh } = useTenantLook();
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ name: string; tokens: TokenSet } | null>(null);
  // What is wrong with the chosen file, or with saving none.
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refocus, setRefocus] = useState(false);
  const inUse = Boolean(theme.tokens);

  useLeaveGuard(
    chosen !== null,
    'You chose a stylesheet but have not saved it. If you leave this page, you will lose it.',
  );

  // The button that opened the dialog goes when the stylesheet does, so focus moves to the file field once the dialog has closed.
  useEffect(() => {
    if (!refocus) return;
    const timer = setTimeout(() => {
      picker.current?.focus();
      setRefocus(false);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [refocus]);

  const form = useSubmit(['stylesheet'], async () => {
    if (chosen === null) {
      setFileProblems([NO_FILE]);
      setAttempt((count) => count + 1);
      return;
    }
    onChanged(await callApi(updateThemeTokens, { body: { tokens: chosen.tokens } }));
    setChosen(null);
    if (picker.current) picker.current.value = '';
    setFileProblems([]);
    setDone('Stylesheet saved.');
    // The page takes the new look as soon as the funder's stylesheet is read again.
    await refresh().catch(() => undefined);
  });

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setDone(null);
    setChosen(null);
    setFileProblems([]);
    if (file === undefined) return;
    const read = await readStylesheet(file);
    if (read.tokens) setChosen({ name: file.name, tokens: read.tokens });
    else {
      setFileProblems(read.problems);
      setAttempt((count) => count + 1);
    }
  }

  async function goBack() {
    if (removing) return;
    setRemoving(true);
    setDone(null);
    setRemoveProblem(null);
    try {
      onChanged(await callApi(removeThemeTokens, {}));
      setChosen(null);
      setFileProblems([]);
      if (picker.current) picker.current.value = '';
      setDone('Your look is back to your preset.');
      setAsking(false);
      setRefocus(true);
      await refresh().catch(() => undefined);
    } catch (error) {
      setAsking(false);
      setRemoveProblem(refusal(error));
      setAttempt((count) => count + 1);
    } finally {
      setRemoving(false);
    }
  }

  const problems = [
    ...fileProblems.map((message) => ({ fieldId: 'stylesheet', message })),
    ...form.errors,
    ...(removeProblem === null ? [] : [{ fieldId: 'go-back', message: removeProblem }]),
  ];

  return (
    <SettingsCard title="Your own stylesheet">
      <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <p className="text-body text-muted">
          Download your look as a stylesheet, change its colours, corners or font in any text
          editor, then upload it. Every value and every contrast pair is checked, and any problem is
          listed with its line.
        </p>
        <ErrorSummary key={`${String(attempt)}-${String(form.attempt)}`} errors={problems} />
        <div>
          <Button
            onClick={() => {
              downloadText(stylesheetFileName(slug), currentStylesheet(theme, name));
            }}
          >
            Download stylesheet
          </Button>
        </div>
        <FormField
          id="stylesheet"
          label="Upload stylesheet"
          hint="A .css file of 32 KB or less, written like the one you download. Nothing is saved until you save it."
          error={
            fileProblems.length > 0
              ? 'Fix the problems listed above, then choose the file again.'
              : undefined
          }
        >
          <Input
            ref={picker}
            name="stylesheet"
            type="file"
            accept=".css,text/css"
            onChange={(event) => {
              void choose(event);
            }}
          />
        </FormField>
        <p role="status" className="text-body text-ink">
          {chosen !== null &&
            `Ready to save: ${chosen.name}. The preview shows it in both schemes.`}
          {done !== null && <span className="font-medium text-success">{done}</span>}
        </p>
        {chosen !== null && (
          <div className="flex flex-col gap-2">
            <h3 className="text-body font-medium text-ink">Preview of the uploaded stylesheet</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {(['light', 'dark'] as const).map((scheme) => (
                <div key={scheme} aria-hidden="true" className="flex flex-col gap-1">
                  <span className="text-body font-medium text-muted">
                    {scheme === 'light' ? 'Light' : 'Dark'}
                  </span>
                  <LookPreview
                    look={{ tokens: chosen.tokens }}
                    scheme={scheme}
                    slug={slug}
                    name={name}
                    hasLogo={theme.hasLogo}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
            Save stylesheet
          </Button>
          {inUse && (
            <Button
              id="go-back"
              onClick={() => {
                setAsking(true);
              }}
            >
              Go back to a preset
            </Button>
          )}
        </div>
      </form>
      <Dialog
        open={asking}
        onOpenChange={(open) => {
          if (!removing) setAsking(open);
        }}
        title="Go back to a preset?"
        description={`This removes your stylesheet. Your look returns to the ${presetLabels[theme.preset]} preset with the brand colour ${theme.brandColour}. Download the stylesheet first if you want to keep a copy.`}
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep stylesheet
            </Button>
            <Button
              variant="primary"
              aria-disabled={removing || undefined}
              onClick={() => {
                void goBack();
              }}
            >
              Go back to preset
            </Button>
          </>
        }
      />
    </SettingsCard>
  );
}
