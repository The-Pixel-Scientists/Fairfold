// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, Link, useCan, useSearch } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import ContractPage from './data-contracts/ContractPage.tsx';
import ContractsPage from './data-contracts/ContractsPage.tsx';
import DisclosurePage from './disclosure/DisclosurePage.tsx';
import { addressSchema, insightPath } from './paths.ts';
import type { View } from './paths.ts';
import PrepareRunPage from './publication/PrepareRunPage.tsx';
import RunListPage from './publication/RunListPage.tsx';
import RunPage from './publication/RunPage.tsx';
import ReportFormPage from './reports/ReportFormPage.tsx';
import ReportListPage from './reports/ReportListPage.tsx';
import ReportPage from './reports/ReportPage.tsx';

type Section = 'reports' | 'publication' | 'disclosure' | 'contracts';

const sections: Record<View, Section> = {
  reports: 'reports',
  report: 'reports',
  'report-new': 'reports',
  'report-edit': 'reports',
  publication: 'publication',
  'publication-new': 'publication',
  'publication-run': 'publication',
  disclosure: 'disclosure',
  contracts: 'contracts',
  contract: 'contracts',
};

const links: readonly { section: Section; label: string; to: string }[] = [
  { section: 'reports', label: 'Reports', to: insightPath('reports') },
  { section: 'publication', label: 'Publication runs', to: insightPath('publication') },
  { section: 'disclosure', label: 'Disclosure rule', to: insightPath('disclosure') },
  { section: 'contracts', label: 'Data contracts', to: insightPath('contracts') },
];

function Screen({ view, id, module }: { view: View; id?: string; module?: string }): ReactNode {
  switch (view) {
    case 'reports':
      return <ReportListPage />;
    case 'report':
      return id === undefined ? <ReportListPage /> : <ReportPage reportId={id} />;
    case 'report-new':
      return <ReportFormPage />;
    case 'report-edit':
      return id === undefined ? <ReportListPage /> : <ReportFormPage reportId={id} />;
    case 'publication':
      return <RunListPage />;
    case 'publication-new':
      return <PrepareRunPage />;
    case 'publication-run':
      return id === undefined ? <RunListPage /> : <RunPage runId={id} />;
    case 'disclosure':
      return <DisclosurePage />;
    case 'contracts':
      return <ContractsPage />;
    case 'contract':
      return module === undefined ? <ContractsPage /> : <ContractPage module={module} />;
  }
}

/** Insight's screens. The server decides who may do what; this hides what a member lacks. */
export default function InsightPage() {
  const address = useSearch(addressSchema);
  const { view, id, module } = address.success ? address.data : { view: 'reports' as const };
  const allowed: Record<Section, boolean> = {
    reports: useCan('insight.reports.read'),
    publication: useCan('insight.publications.manage'),
    disclosure: useCan('insight.disclosure_rules.manage'),
    contracts: useCan('insight.reports.read'),
  };
  const shown = links.filter(({ section }) => allowed[section]);
  if (shown.length === 0) {
    return (
      <EmptyState title="You cannot open insight">
        <p>Ask an administrator at your funder to give you a role that can read reports.</p>
      </EmptyState>
    );
  }
  const section = sections[view];
  return (
    <div className="flex flex-col gap-stack">
      <nav aria-label="Insight">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body">
          {shown.map((link) => (
            <li key={link.section}>
              <Link
                to={link.to}
                aria-current={link.section === section ? 'page' : undefined}
                className="font-medium text-ink underline-offset-4 hover:underline aria-[current=page]:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {allowed[section] ? (
        <Screen
          view={view}
          {...(id === undefined ? {} : { id })}
          {...(module === undefined ? {} : { module })}
        />
      ) : (
        <EmptyState title="You cannot open this page">
          <p>Ask an administrator at your funder to give you a role that can.</p>
        </EmptyState>
      )}
    </div>
  );
}
