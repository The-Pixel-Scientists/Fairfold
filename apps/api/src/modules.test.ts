// SPDX-License-Identifier: AGPL-3.0-or-later

import { listAuditEvents, searchAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import { retentionRoutes } from '@pixel-scientists/domain/platform/retention';
import { searchTerm } from '@pixel-scientists/domain/platform/search';
import {
  readErasureRequest,
  requestErasure,
} from '@pixel-scientists/domain/platform/subject-access';
import {
  addEmbedOrigin,
  getLogo,
  getPublicEmbedOrigins,
  getPublicTenant,
  getSettings,
  getTheme,
  getThemeCss,
  listEmbedOrigins,
  listModules,
  removeEmbedOrigin,
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
import { approvalRoutes } from '@pixel-scientists/domain/workflow';
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
  getPublicRound,
  listPublicRounds,
  messageRoutes,
  monitoringRoutes,
  noteRoutes,
  programmeRoutes,
  reminderRoutes,
  reviewRoutes,
  savedViewRoutes,
  spreadRoutes,
  submissionRoutes,
  templateRoutes,
  triageRoutes,
} from '@pixel-scientists/grants/contracts';
import { impactRoutes } from '@pixel-scientists/impact/contracts';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { partyResolvers } from '@pixel-scientists/party/server';
import { defineQueue } from '@pixel-scientists/db/jobs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { releaseEmailJob } from './decision-emails.ts';
import {
  collectModuleJobs,
  composeModules,
  composedFor,
  mergeCompositions,
  moduleCompositions,
} from './modules.ts';
import type { ModuleComposition, ModuleFactory } from './modules/types.ts';
import { workerModuleJobs } from './worker/module-jobs.ts';
import type { ModuleJob } from './worker/registry.ts';

const publicTenants = {
  tenant: () => Promise.resolve(undefined),
  logo: () => Promise.resolve(undefined),
  rounds: () => Promise.resolve([]),
  embedOrigins: () => Promise.resolve([]),
};

describe('composeModules', () => {
  it('registers a handler for every platform, party, grants and impact route contract, once', () => {
    const { routes } = composeModules({ publicTenants });

    expect(routes.map((route) => route.contract)).toEqual([
      listAuditEvents,
      searchAuditEvents,
      searchTerm,
      ...Object.values(approvalRoutes),
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
      listEmbedOrigins,
      addEmbedOrigin,
      removeEmbedOrigin,
      ...Object.values(retentionRoutes),
      requestErasure,
      readErasureRequest,
      getWarehouseSnapshot,
      getPublicTenant,
      getThemeCss,
      getLogo,
      listPublicRounds,
      getPublicRound,
      getPublicEmbedOrigins,
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
      triageRoutes.setOwner,
      triageRoutes.setOwners,
      triageRoutes.changeLabels,
      triageRoutes.changeLabelsInBulk,
      triageRoutes.listLabels,
      triageRoutes.createLabel,
      triageRoutes.updateLabel,
      triageRoutes.archiveLabel,
      ...Object.values(savedViewRoutes),
      ...Object.values(templateRoutes),
      ...Object.values(assessmentRoutes),
      assignReviewersAutomatically,
      ...Object.values(spreadRoutes),
      ...Object.values(reviewRoutes),
      ...Object.values(decisionRoutes),
      ...Object.values(exportRoutes),
      ...Object.values(reminderRoutes),
      ...Object.values(impactRoutes),
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
        ...Object.values(reminderRoutes),
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

describe('the module compositions', () => {
  const mail = {
    sender: { send: () => Promise.resolve({ sent: true as const }) },
    portalOrigin: 'https://portal.example.org',
  };
  const job = (name: string): ModuleJob => ({
    queue: defineQueue(name, 'tenant', z.strictObject({})),
    handler: () => Promise.resolve(),
  });
  const adding =
    (composition: ModuleComposition): ModuleFactory =>
    () =>
      composition;
  const firstRoute = composeModules({ publicTenants }).routes[0];
  if (firstRoute === undefined) throw new Error('The platform has no routes.');

  it('has one composition per wave 1 module, and each starts empty', () => {
    const deps = moduleCompositions.map((factory) => factory({} as Parameters<ModuleFactory>[0]));

    expect(deps).toHaveLength(6);
    expect(deps).toEqual(Array.from({ length: 6 }, () => ({})));
  });

  it('adds nothing to the erasure contributions or the worker queues while empty', () => {
    expect(composedFor({}).erasure.map(({ module }) => module)).toEqual([
      'party',
      'grants',
      'platform',
    ]);
    expect(workerModuleJobs(mail).map(({ queue }) => queue.name)).toEqual([
      'grants.release_email',
      'grants.message_notification',
      'grants.reminder_scan',
      'grants.reminder_send',
      'platform.erasure',
    ]);
  });

  it('takes the routes, jobs and contributions of every composition', () => {
    const extra = job('fake_module.extra');
    const merged = mergeCompositions([
      { jobs: [extra] },
      { erasure: [{ module: 'crm', erase: () => Promise.resolve({}) }] },
    ]);

    expect(merged.jobs).toContain(extra);
    expect(merged.erasure.map(({ module }) => module)).toEqual([
      'party',
      'grants',
      'platform',
      'crm',
    ]);
  });

  it('stops start-up on a route two compositions both define, naming it', () => {
    const { method, path } = firstRoute.contract;

    expect(() => composeModules({ publicTenants }, [adding({ routes: [firstRoute] })])).toThrow(
      `The route ${method} ${path} is defined twice.`,
    );
  });

  it('stops start-up on a queue two compositions both define, naming it', () => {
    const same = job('fake_module.twice');

    expect(() => mergeCompositions([{ jobs: [same] }, { jobs: [same] }])).toThrow(
      'The queue fake_module.twice is defined twice.',
    );
  });

  it('stops start-up on a scope rule two compositions both define, naming it', () => {
    const rule = Object.keys(partyResolvers)[0] as keyof typeof partyResolvers;
    const resolver = () => Promise.resolve(true);

    expect(() => mergeCompositions([{ resolvers: { [rule]: resolver } }])).toThrow(
      `The scope rule ${rule} is defined twice.`,
    );
  });

  it('stops start-up on a module that contributes twice', () => {
    const erasure = { module: 'crm' as const, erase: () => Promise.resolve({}) };

    expect(() => mergeCompositions([{ erasure: [erasure] }, { erasure: [erasure] }])).toThrow(
      'The erasure contribution of crm is defined twice.',
    );
  });

  it.each([
    ['subjectRules', { subjectRules: { 'crm.x.viewed': { none: 'Not about a party.' } } }],
    [
      'subjectData',
      { subjectData: [{ module: 'crm' as const, collect: () => Promise.resolve({}) }] },
    ],
    ['repoints', { repoints: [{ module: 'crm' as const, repoint: () => Promise.resolve() }] }],
  ] as const)('refuses a composition that supplies %s, which nothing reads yet', (list, found) => {
    expect(() => mergeCompositions([found as never])).toThrow(
      `The platform does not wire the ${list} of a composition yet.`,
    );
  });
});
