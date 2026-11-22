// SPDX-License-Identifier: AGPL-3.0-or-later

import { readTeam } from '@pixel-scientists/domain/platform/team';
import type { TeamDetail } from '@pixel-scientists/domain/platform/team';
import {
  Button,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  PageHeading,
  Tag,
  WhenLoaded,
  useCan,
  useLoad,
  useParams,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../../api.ts';
import { loadMembers } from '../audit-log/loaders.ts';
import { roleLabels } from './change.ts';
import { TEAMS_PATH } from './paths.ts';
import { AddMemberDialog, ConfirmDialog, removeDescription } from './TeamDialogs.tsx';
import type { Candidate } from './TeamDialogs.tsx';
import { personName } from './teamChange.ts';
import { useTeamChanges } from './useTeamChanges.tsx';

type Member = TeamDetail['members'][number];

const load = (teamId: string) =>
  Promise.all([callApi(readTeam, { params: { teamId } }), loadMembers()]).then(
    ([team, members]) => ({ team, members }),
  );

type Open = { kind: 'add' } | { kind: 'remove'; member: Member };

function DetailView({ teamId }: { teamId: string }) {
  const { state, retry } = useLoad(load, teamId);
  const [changed, setChanged] = useState<TeamDetail | null>(null);
  const [open, setOpen] = useState<Open | null>(null);

  const loaded = state.status === 'ready' ? state.value : null;
  const team = changed ?? loaded?.team ?? null;
  const done = useTeamChanges(({ team: summary, change }) => {
    setOpen(null);
    if (team === null) return;
    const members =
      change.kind === 'add'
        ? [...team.members, { ...change.person, status: 'active' as const }]
        : change.kind === 'remove'
          ? team.members.filter(({ membershipId }) => membershipId !== change.person.membershipId)
          : team.members;
    setChanged({ ...summary, members });
  });
  const common = {
    run: done.run,
    hidden: done.asking,
    onClose: () => {
      setOpen(null);
    },
  };

  const archived = team !== null && team.archivedAt !== null;
  const inTeam = new Set(team?.members.map(({ membershipId }) => membershipId));
  const candidates: Candidate[] = (loaded?.members ?? [])
    .filter(({ id, status }) => status === 'active' && !inTeam.has(id))
    .map(({ id, name, roles }) => ({ membershipId: id, name, roles: roleLabels(roles) }));

  const columns: readonly Column<Member>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (member) =>
        member.name ?? <span className="font-normal text-muted">Not named yet</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (member) =>
        member.status === 'active' ? (
          <Tag tone="success">Active</Tag>
        ) : (
          <Tag tone="warning">Suspended</Tag>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (member) =>
        !archived && (
          <Button
            variant="quiet"
            onClick={() => {
              setOpen({ kind: 'remove', member });
            }}
          >
            Remove from team <span className="sr-only">for {personName(member)}</span>
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={team?.name ?? 'Team'}
        breadcrumbs={[{ label: 'Teams', to: TEAMS_PATH }, { label: team?.name ?? 'Team' }]}
        {...(team !== null && {
          description:
            'A team decides which records its members can reach. It does not give anyone a permission; roles do that, on the Team page.',
          actions: !archived && (
            <Button
              variant="primary"
              onClick={() => {
                setOpen({ kind: 'add' });
              }}
            >
              Add member
            </Button>
          ),
        })}
      />
      <WhenLoaded state={state} label="Loading the team" retry={retry}>
        {() =>
          team === null ? null : (
            <>
              {done.status}
              {archived && (
                <Notice tone="neutral" title="This team is archived">
                  It no longer gives its members reach to records. Its history stays on file.
                </Notice>
              )}
              {team.members.length === 0 ? (
                <EmptyState
                  title="No one is in this team"
                  headingLevel="h2"
                  {...(!archived && {
                    action: (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setOpen({ kind: 'add' });
                        }}
                      >
                        Add member
                      </Button>
                    ),
                  })}
                >
                  <p>Add the members who should reach the records assigned to this team.</p>
                </EmptyState>
              ) : (
                <DataTable
                  caption={`Members of ${team.name}`}
                  columns={columns}
                  rows={team.members}
                  rowKey={(member) => member.membershipId}
                />
              )}
              {open?.kind === 'add' && (
                <AddMemberDialog {...common} team={team} candidates={candidates} />
              )}
              {open?.kind === 'remove' && (
                <ConfirmDialog
                  {...common}
                  danger
                  title={`Remove ${personName(open.member)} from ${team.name}?`}
                  description={removeDescription(team, open.member)}
                  submit="Remove from team"
                  change={{ kind: 'remove', team, person: open.member }}
                />
              )}
              {done.dialog}
            </>
          )
        }
      </WhenLoaded>
    </>
  );
}

function Cannot() {
  return (
    <>
      <PageHeading>Team</PageHeading>
      <EmptyState title="You cannot manage teams">
        <p>Ask an administrator at your funder to give you access.</p>
      </EmptyState>
    </>
  );
}

/** One team: its members, with who to add and who to remove. */
export default function TeamDetailPage() {
  const allowed = useCan('platform.teams.manage');
  const { teamId } = useParams();
  return (
    <div className="flex flex-col gap-stack">
      {allowed && teamId !== undefined ? <DetailView teamId={teamId} /> : <Cannot />}
    </div>
  );
}
