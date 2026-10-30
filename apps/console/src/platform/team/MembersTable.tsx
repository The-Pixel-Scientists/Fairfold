// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import type { Invitation, Member } from '@pixel-scientists/domain/platform/team';
import type { ReactNode } from 'react';

import { formatWhen } from '../audit-log/words.ts';
import { displayName, roleLabel } from './change.ts';

const Roles = ({ roles }: { roles: Member['roles'] }) => (
  <span className="flex flex-wrap gap-1">
    {roles.map((role) => (
      <Tag key={role}>{roleLabel(role)}</Tag>
    ))}
  </span>
);

/** A quiet button whose name says who it acts on, for a screen reader reaching it out of its row. */
function RowAction({
  verb,
  who,
  onClick,
}: {
  verb: string;
  who: string;
  onClick: () => void;
}): ReactNode {
  return (
    <Button variant="quiet" onClick={onClick}>
      {verb} <span className="sr-only">for {who}</span>
    </Button>
  );
}

export interface MembersTableProps {
  members: readonly Member[];
  /** The signed-in person's membership. Their own row offers no actions. */
  selfId: string;
  /** Names the table, such as "Members of Northfield Foundation". */
  caption: string;
  empty: ReactNode;
  onChangeRoles: (member: Member) => void;
  onSuspend: (member: Member) => void;
  onReinstate: (member: Member) => void;
  onRemove: (member: Member) => void;
  onHelp: () => void;
}

export function MembersTable({
  members,
  selfId,
  caption,
  empty,
  onChangeRoles,
  onSuspend,
  onReinstate,
  onRemove,
  onHelp,
}: MembersTableProps) {
  const columns: readonly Column<Member>[] = [
    {
      key: 'name',
      header: 'Name',
      rowHeader: true,
      cell: (member) => (
        <span className="flex items-center gap-2">
          {member.name ?? <span className="font-normal text-muted">Not named yet</span>}
          {member.id === selfId && <Tag tone="info">You</Tag>}
        </span>
      ),
    },
    { key: 'email', header: 'Email', cell: (member) => member.email },
    { key: 'roles', header: 'Roles', cell: (member) => <Roles roles={member.roles} /> },
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
        member.id === selfId ? null : (
          <span className="inline-flex gap-1">
            <RowAction
              verb="Change roles"
              who={displayName(member)}
              onClick={() => {
                onChangeRoles(member);
              }}
            />
            {member.status === 'active' ? (
              <RowAction
                verb="Suspend"
                who={displayName(member)}
                onClick={() => {
                  onSuspend(member);
                }}
              />
            ) : (
              <RowAction
                verb="Reinstate"
                who={displayName(member)}
                onClick={() => {
                  onReinstate(member);
                }}
              />
            )}
            <RowAction
              verb="Remove"
              who={displayName(member)}
              onClick={() => {
                onRemove(member);
              }}
            />
          </span>
        ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns}
      rows={members}
      rowKey={(member) => member.id}
      empty={empty}
      onOpenRow={(member) => {
        if (member.id !== selfId) onChangeRoles(member);
      }}
      onHelp={onHelp}
    />
  );
}

export interface InvitationsTableProps {
  invitations: readonly Invitation[];
  /** The funder's time zone, or null for the browser's. */
  zone: string | null;
  empty: ReactNode;
  onRevoke: (invitation: Invitation) => void;
}

export function InvitationsTable({ invitations, zone, empty, onRevoke }: InvitationsTableProps) {
  const columns: readonly Column<Invitation>[] = [
    { key: 'email', header: 'Email', rowHeader: true, cell: (invitation) => invitation.email },
    { key: 'roles', header: 'Roles', cell: (invitation) => <Roles roles={invitation.roles} /> },
    {
      key: 'expires',
      header: 'Expires',
      cell: (invitation) => formatWhen(invitation.expiresAt, zone ?? undefined),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (invitation) => (
        <Button
          variant="quiet"
          onClick={() => {
            onRevoke(invitation);
          }}
        >
          Revoke invitation <span className="sr-only">to {invitation.email}</span>
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      caption="Invitations waiting to be accepted"
      captionHidden
      columns={columns}
      rows={invitations}
      rowKey={(invitation) => invitation.id}
      empty={empty}
    />
  );
}
