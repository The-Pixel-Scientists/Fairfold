// SPDX-License-Identifier: AGPL-3.0-or-later

import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import { retentionRoutes } from '@pixel-scientists/domain/platform/retention';
import {
  readErasureRequest,
  requestErasure,
} from '@pixel-scientists/domain/platform/subject-access';
import {
  getLogo,
  getPublicTenant,
  getSettings,
  getTheme,
  getThemeCss,
  listModules,
  removeLogo,
  removeThemeTokens,
  switchModule,
  updateSettings,
  updateTheme,
  updateThemeTokens,
  uploadLogo,
} from '@pixel-scientists/domain/platform/settings';
import { teamRoutes } from '@pixel-scientists/domain/platform/team';
import { getWarehouseSnapshot } from '@pixel-scientists/domain/warehouse';
import {
  adjustmentRoutes,
  applicationRoutes,
  assessmentRoutes,
  assistedRoutes,
  assignReviewersAutomatically,
  attachmentRoutes,
  decisionRoutes,
  exportRoutes,
  formRoutes,
  messageRoutes,
  monitoringRoutes,
  noteRoutes,
  programmeRoutes,
  reviewRoutes,
  spreadRoutes,
  submissionRoutes,
} from '@pixel-scientists/grants/contracts';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { defineQueue } from '@pixel-scientists/db/jobs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { releaseEmailJob } from './decision-emails.ts';
import { collectModuleJobs, composeModules } from './modules.ts';
import type { ModuleJob } from './worker/registry.ts';

const publicTenants = {
  tenant: () => Promise.resolve(undefined),
  logo: () => Promise.resolve(undefined),
};

describe('composeModules', () => {
  it('registers a handler for every platform, party and grants route contract, once', () => {
    const { routes } = composeModules({ publicTenants });

    expect(routes.map((route) => route.contract)).toEqual([
      listAuditEvents,
      ...Object.values(teamRoutes),
      getSettings,
      updateSettings,
      getTheme,
      updateTheme,
      updateThemeTokens,
      removeThemeTokens,
      uploadLogo,
      removeLogo,
      listModules,
      switchModule,
      ...Object.values(retentionRoutes),
      requestErasure,
      readErasureRequest,
      getWarehouseSnapshot,
      getPublicTenant,
      getThemeCss,
      getLogo,
      ...Object.values(partyRoutes),
      ...Object.values(programmeRoutes),
      ...Object.values(formRoutes),
      ...Object.values(applicationRoutes),
      ...Object.values(attachmentRoutes),
      ...Object.values(submissionRoutes),
      ...Object.values(adjustmentRoutes),
      ...Object.values(assistedRoutes),
      ...Object.values(noteRoutes),
      ...Object.values(messageRoutes),
      ...Object.values(assessmentRoutes),
      assignReviewersAutomatically,
      ...Object.values(spreadRoutes),
      ...Object.values(reviewRoutes),
      ...Object.values(decisionRoutes),
      ...Object.values(exportRoutes),
    ]);
  });

  it('leaves the monitoring routes off until the audit log hides their events (ADR 0032)', () => {
    const { routes } = composeModules({ publicTenants });
    for (const contract of Object.values(monitoringRoutes)) {
      expect(routes.map(({ contract: registered }) => registered)).not.toContain(contract);
    }
  });

  it('resolves every scope rule the module routes use, and none that is the platform’s', () => {
    const { resolvers } = composeModules({ publicTenants });
    const used = new Set(
      [
        ...Object.values(partyRoutes),
        ...Object.values(programmeRoutes),
        ...Object.values(formRoutes),
        ...Object.values(applicationRoutes),
        ...Object.values(attachmentRoutes),
        ...Object.values(submissionRoutes),
        ...Object.values(adjustmentRoutes),
        ...Object.values(assistedRoutes),
        ...Object.values(noteRoutes),
        ...Object.values(messageRoutes),
        ...Object.values(assessmentRoutes),
        assignReviewersAutomatically,
        ...Object.values(spreadRoutes),
        ...Object.values(reviewRoutes),
        ...Object.values(exportRoutes),
        ...Object.values(decisionRoutes),
      ].map((contract) => contract.scope),
    );

    expect(Object.keys(resolvers).sort()).toEqual(
      [...used].filter((rule) => rule !== 'tenant').sort(),
    );
  });
});

describe('collectModuleJobs', () => {
  const job = (name: string): ModuleJob => ({
    queue: defineQueue(name, 'tenant', z.strictObject({})),
    handler: () => Promise.resolve(),
  });

  it('attaches each registered module job once, whether or not any tenant has the module on', () => {
    const first = job('fake_module.first');
    const second = job('fake_module.second');

    expect(collectModuleJobs([{ jobs: [first] }, {}, { jobs: [second] }])).toEqual([first, second]);
  });

  it('takes the grants release email job for the worker', () => {
    const jobs = collectModuleJobs([
      {
        jobs: [
          releaseEmailJob({
            sender: { send: () => Promise.resolve({ sent: true }) },
            portalOrigin: 'https://portal.example.org',
          }),
        ],
      },
    ]);

    expect(jobs.map(({ queue }) => [queue.name, queue.kind])).toEqual([
      ['grants.release_email', 'tenant'],
    ]);
  });

  it('stops start-up on a queue name defined twice', () => {
    const same = job('fake_module.same');

    expect(() => collectModuleJobs([{ jobs: [same] }, { jobs: [same] }])).toThrow(
      'fake_module.same is defined twice',
    );
  });
});
