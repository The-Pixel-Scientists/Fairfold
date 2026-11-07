// SPDX-License-Identifier: AGPL-3.0-or-later

import { countBackupCodes, generateBackupCodes } from '@pixel-scientists/domain/auth';
import { BackupCodeList, Button, WhenLoaded, useLoad } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import type { StepUp } from '../../platform/team/useStepUp.tsx';
import { Section, useAction } from './parts.tsx';

const loadCount = () => callApi(countBackupCodes, {}).then(({ remaining }) => remaining);

const left = (count: number) =>
  count === 0
    ? 'You have no backup codes left.'
    : `You have ${String(count)} backup ${count === 1 ? 'code' : 'codes'} left.`;

/**
 * The codes live only in this component's state: they are never put in the
 * address, history, storage or title, and they are gone once the person
 * says they are saved or leaves the page.
 */
export function BackupCodesSection({ stepUp }: { stepUp: StepUp }) {
  const { state, retry } = useLoad(loadCount);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const action = useAction(stepUp, 'generate-codes');
  const remaining = saved ?? (state.status === 'ready' ? state.value : 0);

  async function generate() {
    const made = await action.run(async () => (await callApi(generateBackupCodes, {})).codes);
    if (made !== null) setCodes(made);
  }

  return (
    <Section id="backup-codes" title="Backup codes" headingRef={heading}>
      <p className="text-body text-muted">
        Backup codes let you sign in if you lose your authenticator app or passkey. Each works once.
      </p>
      {action.summary}
      <WhenLoaded state={state} label="Loading your backup codes" retry={retry}>
        {() =>
          codes === null ? (
            <>
              <p className="text-body">{left(remaining)}</p>
              <div>
                <Button
                  id="generate-codes"
                  onClick={() => {
                    void generate();
                  }}
                >
                  {remaining === 0 ? 'Generate backup codes' : 'Generate new backup codes'}
                </Button>
              </div>
            </>
          ) : (
            <BackupCodeList
              codes={codes}
              onDone={() => {
                setCodes(null);
                setSaved(codes.length);
                heading.current?.focus();
              }}
            />
          )
        }
      </WhenLoaded>
    </Section>
  );
}
