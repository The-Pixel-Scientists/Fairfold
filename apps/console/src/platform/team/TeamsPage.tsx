// SPDX-License-Identifier: AGPL-3.0-or-later

import { listTeams } from '@pixel-scientists/domain/platform/team';
import type { TeamSummary } from '@pixel-scientists/domain/platform/team';
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  PageHeading,
  Tag,
  WhenLoaded,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { TEAMS_PATH, TEAM_PATH } from './paths.ts';
import { ConfirmDialog, NameDialog } from './TeamDialogs.tsx';
import { useTeamChanges } from './useTeamChanges.tsx';

type Open = { kind: 'create' } | { kind: 'rename' | 'archive'; team: TeamSummary };

const loadTeams = () => callApi(listTeams, {}).then(({ teams }) => teams);

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function TeamsView() {
  const { state, retry } = useLoad(loadTeams);
  const [changes, setChanges] = useState<readonly TeamSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);

  const teams = changes ?? (state.status === 'ready' ? state.value : null);
  const done = useTeamChanges(({ team }) => {
    if (teams !== null) {
      const known = teams.some(({ id }) => id === team.id);
      setChanges(known ? teams.map((one) => (one.id === team.id ? team : one)) : [...teams, team]);
    }
    setOpen(null);
  });
  const common = {
    run: done.run,
    hidden: done.asking,
    onClose: () => {
      setOpen(null);
    },
  };
  const create = () => {
    setOpen({ kind: 'create' });
  };

  const shown = (teams ?? []).filter(({ archivedAt }) => showArchived || archivedAt === null);
  const hasArchived = (teams ?? []).some(({ archivedAt }) => archivedAt !== null);

  const columns: readonly Column<TeamSummary>[] = [
    {
      key: 'name',
      header: 'Team',
      rowHeader: true,
      cell: (team) => <Link to={`${TEAMS_PATH}/${team.id}`}>{team.name}</Link>,
    },
    { key: 'members', header: 'Members', align: 'end', cell: (team) => team.memberCount },
    {
      key: 'status',
      header: 'Status',
      cell: (team) =>
        team.archivedAt === null ? <Tag tone="success">Active</Tag> : <Tag>Archived</Tag>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (team) =>
        team.archivedAt === null && (
          <span className="flex justify-end gap-1">
            <Button
              variant="quiet"
              onClick={() => {
                setOpen({ kind: 'rename', team });
              }}
            >
              Rename <span className="sr-only">{team.name}</span>
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setOpen({ kind: 'archive', team });
              }}
            >
              Archive <span className="sr-only">{team.name}</span>
            </Button>
          </span>
        ),
    },
  ];

  return (
    <>
      {/* The heading is always here, so the router's focus on it survives the loading. */}
      <PageHeader
        title="Teams"
        {...(teams !== null && {
          description: `${plural(teams.filter(({ archivedAt }) => archivedAt === null).length, 'team', 'teams')}. A team decides which records its members can reach. It does not give anyone a permission; roles do that, on the Team page.`,
          actions: (
            <Button variant="primary" onClick={create}>
              Create team
            </Button>
          ),
        })}
      />
      <WhenLoaded state={state} label="Loading teams" retry={retry}>
        {() => (
          <>
            {done.status}
            {teams?.length === 0 ? (
              <EmptyState
                title="No teams yet"
                action={
                  <Button variant="primary" onClick={create}>
                    Create team
                  </Button>
                }
              >
                <p>
                  A team is a group of members that records can be assigned to, so everyone in it
                  can reach them. Create a team, add its members, then assign records to it.
                </p>
              </EmptyState>
            ) : (
              <section aria-label="Teams" className="flex flex-col gap-3">
                {hasArchived && (
                  <Checkbox
                    label="Show archived teams"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                  />
                )}
                <DataTable
                  caption="Teams"
                  captionHidden
                  columns={columns}
                  rows={shown}
                  rowKey={(team) => team.id}
                  empty={
                    <p className="text-muted">
                      No active teams. Choose Show archived teams to see the rest.
                    </p>
                  }
                />
              </section>
            )}
            {open?.kind === 'create' && <NameDialog {...common} />}
            {open?.kind === 'rename' && <NameDialog {...common} team={open.team} />}
            {open?.kind === 'archive' && (
              <ConfirmDialog
                {...common}
                danger
                title={`Archive ${open.team.name}?`}
                description="Its members will no longer see records assigned to it. The team and its history stay on file."
                submit="Archive team"
                change={{ kind: 'archive', team: open.team }}
              />
            )}
            {done.dialog}
          </>
        )}
      </WhenLoaded>
      <p className="text-body text-muted">
        To change what someone can do, change their roles on the{' '}
        <Link to={TEAM_PATH}>Team page</Link>.
      </p>
    </>
  );
}

function Cannot() {
  return (
    <>
      <PageHeading>Teams</PageHeading>
      <EmptyState title="You cannot manage teams">
        <p>Ask an administrator at your funder to give you access.</p>
      </EmptyState>
    </>
  );
}

/** Teams for administrators: who is in each, and so which records they can reach. */
export default function TeamsPage() {
  const allowed = useCan('platform.teams.manage');
  return <div className="flex flex-col gap-stack">{allowed ? <TeamsView /> : <Cannot />}</div>;
}
