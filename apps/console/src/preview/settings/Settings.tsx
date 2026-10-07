// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Settings. The funder's details, look and logo, and which
// Fairfold tools are on, as the built settings screens show them.

import { PageHeader, Tabs } from '@pixel-scientists/ui';

import { Eyebrow } from '../decide/parts.tsx';
import { funder } from '../story.ts';
import { GeneralTab } from './GeneralTab.tsx';
import { LookTab } from './LookTab.tsx';
import { ModulesTab } from './ModulesTab.tsx';

export default function Settings() {
  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        eyebrow={
          <Eyebrow>
            <span>{funder.name}</span>
          </Eyebrow>
        }
        title="Settings"
        description="How your funder appears to staff and applicants, and which Fairfold tools are on. Only administrators can change these."
      />
      <div className="max-w-3xl">
        <Tabs
          label="Settings sections"
          tabs={[
            { id: 'general', label: 'General', content: <GeneralTab /> },
            { id: 'look', label: 'Look and logo', content: <LookTab /> },
            { id: 'modules', label: 'Modules', content: <ModulesTab /> },
          ]}
        />
      </div>
    </div>
  );
}
