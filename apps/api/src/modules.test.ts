// SPDX-License-Identifier: AGPL-3.0-or-later

import { listAuditEvents } from '@pixel-scientists/domain/platform/audit-log';
import {
  getLogo,
  getPublicTenant,
  getSettings,
  getTheme,
  getThemeCss,
  listModules,
  removeLogo,
  switchModule,
  updateSettings,
  updateTheme,
  uploadLogo,
} from '@pixel-scientists/domain/platform/settings';
import {
  applicationRoutes,
  assessmentRoutes,
  assignReviewersAutomatically,
  formRoutes,
  programmeRoutes,
  reviewRoutes,
  spreadRoutes,
  submissionRoutes,
} from '@pixel-scientists/grants/contracts';
import { partyRoutes } from '@pixel-scientists/party/contracts';
import { describe, expect, it } from 'vitest';

import { composeModules } from './modules.ts';

const publicTenants = {
  tenant: () => Promise.resolve(undefined),
  logo: () => Promise.resolve(undefined),
};

describe('composeModules', () => {
  it('registers a handler for every platform, party and grants route contract, once', () => {
    const { routes } = composeModules({ publicTenants });

    expect(routes.map((route) => route.contract)).toEqual([
      listAuditEvents,
      getSettings,
      updateSettings,
      getTheme,
      updateTheme,
      uploadLogo,
      removeLogo,
      listModules,
      switchModule,
      getPublicTenant,
      getThemeCss,
      getLogo,
      ...Object.values(partyRoutes),
      ...Object.values(programmeRoutes),
      ...Object.values(formRoutes),
      ...Object.values(applicationRoutes),
      ...Object.values(submissionRoutes),
      ...Object.values(assessmentRoutes),
      assignReviewersAutomatically,
      ...Object.values(spreadRoutes),
      ...Object.values(reviewRoutes),
    ]);
  });

  it('resolves every scope rule the module routes use, and none that is the platform’s', () => {
    const { resolvers } = composeModules({ publicTenants });
    const used = new Set(
      [
        ...Object.values(partyRoutes),
        ...Object.values(programmeRoutes),
        ...Object.values(formRoutes),
        ...Object.values(applicationRoutes),
        ...Object.values(submissionRoutes),
        ...Object.values(assessmentRoutes),
        assignReviewersAutomatically,
        ...Object.values(spreadRoutes),
        ...Object.values(reviewRoutes),
      ].map((contract) => contract.scope),
    );

    expect(Object.keys(resolvers).sort()).toEqual(
      [...used].filter((rule) => rule !== 'tenant').sort(),
    );
  });
});
