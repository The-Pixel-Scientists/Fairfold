// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Panel, Tag } from '@pixel-scientists/ui';

import { checks, trustees } from '../featured.ts';
import { EyeOffIcon } from '../icons.tsx';
import { Notice } from '../Notice.tsx';

/**
 * Registry checks on the organisation, for staff only. They are kept apart
 * from the application on purpose: people see what they need, so scoring
 * stays on the application and the checks stay with the people who decide
 * whether the organisation is safe to fund.
 */
export function DiligenceTab() {
  return (
    <div className="flex flex-col gap-5">
      <Notice
        tone="info"
        icon={<EyeOffIcon />}
        title="Staff only. Reviewers never see this tab, so scoring stays on the application."
      >
        <p>
          Due diligence is not blind, but it is kept apart from the grant information. Reviewers
          score the application without knowing who is behind it, so these checks cannot change a
          score. Staff use them to decide whether the organisation is safe to fund.
        </p>
      </Notice>

      <Panel
        title="Registry checks"
        headingLevel="h2"
        actions={<Button variant="quiet">Run checks again</Button>}
      >
        <p className="text-body text-muted">6 of 6 checks complete. Nothing needs following up.</p>
        <ul className="flex flex-col divide-y divide-divider">
          {checks.map((check) => (
            <li
              key={check.name}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                <p className="font-medium text-ink">{check.name}</p>
                <p className="text-body text-ink">{check.detail}</p>
                {check.name === 'Trustees listed' && (
                  <details className="text-body">
                    <summary className="min-h-target cursor-pointer text-muted hover:text-ink">
                      Show the {trustees.length} trustees
                    </summary>
                    <ul className="list-disc pl-5 text-ink">
                      {trustees.map((trustee) => (
                        <li key={trustee}>{trustee}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="text-sm text-muted">
                  Source: {check.source}. Checked {check.checked}.
                </p>
              </div>
              <Tag tone={check.tone}>{check.result}</Tag>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
