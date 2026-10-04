// SPDX-License-Identifier: AGPL-3.0-or-later

import { messages, modules } from '@pixel-scientists/domain/platform';
import type { SwitchableModuleId } from '@pixel-scientists/domain/platform';
import { listModules, switchModule } from '@pixel-scientists/domain/platform/settings';
import { Button, Dialog, asProblem, useSession } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsCard, SettingsFrame, WhenLoaded } from './SettingsFrame.tsx';
import { useLoad } from './useLoad.ts';

interface ModuleState {
  module: SwitchableModuleId;
  enabled: boolean;
}

const about: Record<SwitchableModuleId, string> = {
  grants: 'Programmes, forms, applications, reviews and decisions.',
};

function ModuleList({ initial }: { initial: readonly ModuleState[] }) {
  const { refresh } = useSession();
  const [states, setStates] = useState(initial);
  const [asking, setAsking] = useState<SwitchableModuleId | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState('');

  async function change(module: SwitchableModuleId, enabled: boolean) {
    if (pending) return;
    setPending(true);
    setProblem(null);
    setDone('');
    try {
      const answer = await callApi(switchModule, { body: { module, enabled } });
      setStates(answer.modules);
      setDone(`${modules[module].label} is now ${enabled ? 'on' : 'off'}.`);
      // What the session may do depends on the modules that are on, so read it again.
      await refresh().catch(() => undefined);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? messages.serviceFailed);
    } finally {
      setPending(false);
    }
  }

  const label = asking === null ? '' : modules[asking].label;

  return (
    <SettingsCard title="Available modules">
      <p className="text-body text-muted">
        Switch a module off to hide it from everyone at your funder. Nothing is deleted.
      </p>
      <ul role="list" className="flex flex-col divide-y divide-divider">
        {states.map(({ module, enabled }) => (
          <li key={module} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex flex-col">
              <h3 className="text-body font-medium text-ink">
                {modules[module].label}{' '}
                <span className={enabled ? 'font-semibold text-success' : 'text-muted'}>
                  {enabled ? 'is on' : 'is off'}
                </span>
              </h3>
              <p className="text-body text-muted">{about[module]}</p>
            </div>
            {enabled ? (
              <Button
                aria-disabled={pending || undefined}
                onClick={() => {
                  setAsking(module);
                }}
              >
                Switch off {modules[module].label}
              </Button>
            ) : (
              <Button
                variant="primary"
                aria-disabled={pending || undefined}
                onClick={() => {
                  void change(module, true);
                }}
              >
                Switch on {modules[module].label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      <p role="status" className="text-body font-medium text-success">
        {done}
      </p>
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={`Switch off ${label}?`}
        description={`Nobody at your funder can use ${label} while it is off. Nothing is deleted: its data stays and returns when you switch ${label} on again.`}
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                const module = asking;
                setAsking(null);
                if (module !== null) void change(module, false);
              }}
            >
              Switch off {label}
            </Button>
            <Button
              data-autofocus
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep {label} on
            </Button>
          </>
        }
      />
    </SettingsCard>
  );
}

const loadModules = () => callApi(listModules, {});

function Modules() {
  const { state, retry } = useLoad(loadModules);
  return (
    <WhenLoaded state={state} label="Loading modules" retry={retry}>
      {({ modules: list }) => <ModuleList initial={list} />}
    </WhenLoaded>
  );
}

/** Which modules are on for the funder. */
export default function ModulesPage() {
  return (
    <SettingsFrame title="Modules">
      <Modules />
    </SettingsFrame>
  );
}
