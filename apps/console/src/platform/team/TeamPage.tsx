// SPDX-License-Identifier: AGPL-3.0-or-later

import { getTeam } from '@pixel-scientists/domain/platform/team';
import type { Invitation, Member, Team } from '@pixel-scientists/domain/platform/team';
import {
  Button,
  EmptyState,
  PageHeader,
  PageHeading,
  ShortcutsDialog,
  WhenLoaded,
  useCan,
  useLoad,
  useSession,
} from '@pixel-scientists/ui';
import type { ShortcutGroup } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { loadTimeZone } from '../audit-log/loaders.ts';
import { ConfirmDialog, InviteDialog, RolesDialog } from './ChangeDialogs.tsx';
import type { DialogProps } from './ChangeDialogs.tsx';
import { displayName, perform, roleLabel } from './change.ts';
import type { Change } from './change.ts';
import { InvitationsTable, MembersTable } from './MembersTable.tsx';
import { consoleRoles, roleDescription } from './roleChoices.tsx';
import { useStepUp } from './useStepUp.tsx';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the members table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Change the roles of the person in the row' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

const loadTeam = () =>
  Promise.all([callApi(getTeam, {}), loadTimeZone()]).then(([team, zone]) => ({ team, zone }));

type Open =
  | { kind: 'invite' }
  | { kind: 'roles' | 'suspend' | 'reinstate' | 'remove'; member: Member }
  | { kind: 'revoke'; invitation: Invitation };

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function TeamView() {
  const { state: session } = useSession();
  const { state, retry } = useLoad(loadTeam);
  const stepUp = useStepUp();
  const [changed, setChanged] = useState<Team | null>(null);
  const [message, setMessage] = useState({ text: '', count: 0 });
  const [open, setOpen] = useState<Open | null>(null);
  const [help, setHelp] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const loaded = state.status === 'ready' ? state.value : null;
  const team = changed ?? loaded?.team ?? null;
  const membership = session.status === 'ready' ? session.session.activeMembership : null;
  const funder = membership?.tenant.name ?? 'this funder';
  const selfId = membership?.id ?? '';

  // When a dialog closes on a row that has gone, focus would be lost, so it goes to the list.
  useEffect(() => {
    if (message.count === 0) return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) {
        heading.current?.focus();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [message.count]);

  async function run(change: Change): Promise<void> {
    const outcome = await stepUp.run(() => perform(change));
    if (outcome === null || team === null) return;
    setChanged(outcome.team(team));
    setMessage(({ count }) => ({ text: outcome.message, count: count + 1 }));
    setOpen(null);
  }

  const common: DialogProps = {
    run,
    hidden: stepUp.asking,
    onClose: () => {
      setOpen(null);
    },
  };
  const invite = () => {
    setOpen({ kind: 'invite' });
  };
  const waiting = team?.invitations.length ?? 0;

  return (
    <>
      {/* The heading is always here, so the router's focus on it survives the loading. */}
      <PageHeader
        title="Team"
        {...(team !== null && {
          description: `${plural(team.members.length, 'person', 'people')} can sign in to the console${waiting > 0 ? `, and ${plural(waiting, 'invitation is', 'invitations are')} waiting` : ''}. Roles decide what each person sees and does. Everyone signs in with a password and an authenticator app.`,
          actions: (
            <>
              <Button
                onClick={() => {
                  setHelp(true);
                }}
              >
                Keyboard shortcuts
              </Button>
              <Button variant="primary" onClick={invite}>
                Invite someone
              </Button>
            </>
          ),
        })}
      />
      <WhenLoaded state={state} label="Loading the team" retry={retry}>
        {({ zone }) =>
          team === null ? null : (
            <>
              <p role="status" className="min-h-6 text-body font-medium text-success">
                {message.text}
              </p>
              <section aria-labelledby="members" className="flex flex-col gap-3">
                <h2
                  id="members"
                  ref={heading}
                  tabIndex={-1}
                  className="text-lg font-semibold tracking-tight text-ink"
                >
                  Members
                </h2>
                <MembersTable
                  members={team.members}
                  selfId={selfId}
                  caption={`Members of ${funder}`}
                  empty={
                    <p className="text-muted">
                      No one has joined yet. Choose Invite someone to send them an email with a link
                      to join.
                    </p>
                  }
                  onChangeRoles={(member) => {
                    setOpen({ kind: 'roles', member });
                  }}
                  onSuspend={(member) => {
                    setOpen({ kind: 'suspend', member });
                  }}
                  onReinstate={(member) => {
                    setOpen({ kind: 'reinstate', member });
                  }}
                  onRemove={(member) => {
                    setOpen({ kind: 'remove', member });
                  }}
                  onHelp={() => {
                    setHelp(true);
                  }}
                />
              </section>

              <section aria-labelledby="invitations" className="flex flex-col gap-3">
                <h2 id="invitations" className="text-lg font-semibold tracking-tight text-ink">
                  Invitations waiting
                </h2>
                {waiting === 0 ? (
                  <EmptyState
                    title="No invitations waiting"
                    headingLevel="h3"
                    action={<Button onClick={invite}>Invite someone</Button>}
                  >
                    <p>
                      To add a colleague, choose Invite someone, enter their email address and pick
                      their roles. They get a link that works for 7 days.
                    </p>
                  </EmptyState>
                ) : (
                  <InvitationsTable
                    invitations={team.invitations}
                    zone={zone}
                    empty={null}
                    onRevoke={(invitation) => {
                      setOpen({ kind: 'revoke', invitation });
                    }}
                  />
                )}
              </section>

              <section aria-labelledby="role-guide" className="flex flex-col gap-3">
                <h2 id="role-guide" className="text-lg font-semibold tracking-tight text-ink">
                  What each role can do
                </h2>
                <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
                  {consoleRoles.map((role) => (
                    <div key={role} className="flex flex-col gap-1 border-t border-divider pt-3">
                      <dt className="font-semibold text-ink">{roleLabel(role)}</dt>
                      <dd className="text-body text-muted">{roleDescription(role)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {open?.kind === 'invite' && <InviteDialog {...common} />}
              {open?.kind === 'roles' && (
                <RolesDialog key={open.member.id} member={open.member} {...common} />
              )}
              {open?.kind === 'suspend' && (
                <ConfirmDialog
                  {...common}
                  title={`Suspend ${displayName(open.member)}?`}
                  description={`They will be signed out of ${funder} now, and cannot sign in again until you reinstate them.`}
                  submit={`Suspend ${displayName(open.member)}`}
                  change={{ kind: 'suspend', member: open.member }}
                />
              )}
              {open?.kind === 'reinstate' && (
                <ConfirmDialog
                  {...common}
                  title={`Reinstate ${displayName(open.member)}?`}
                  description={`They will be able to sign in to ${funder} again.`}
                  submit={`Reinstate ${displayName(open.member)}`}
                  change={{ kind: 'reinstate', member: open.member }}
                />
              )}
              {open?.kind === 'remove' && (
                <ConfirmDialog
                  {...common}
                  danger
                  title={`Remove ${displayName(open.member)} from the team?`}
                  description={`They will be signed out of ${funder} now and lose their access. To bring them back, invite them again.`}
                  submit={`Remove ${displayName(open.member)}`}
                  change={{ kind: 'remove', member: open.member }}
                />
              )}
              {open?.kind === 'revoke' && (
                <ConfirmDialog
                  {...common}
                  danger
                  title={`Revoke the invitation to ${open.invitation.email}?`}
                  description="The link in their email will stop working. You can invite them again later."
                  submit="Revoke invitation"
                  change={{ kind: 'revoke', invitation: open.invitation }}
                />
              )}
              <ShortcutsDialog
                open={help}
                onOpenChange={setHelp}
                groups={shortcuts}
                description="These work when a row of the members table has focus. Press Tab to reach the table, then Tab again to reach its first row."
              />
              {stepUp.dialog}
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
      <EmptyState title="You cannot manage the team">
        <p>Ask an administrator at your funder to give you access.</p>
      </EmptyState>
    </>
  );
}

/** The funder's team for its administrators: who can sign in, with which roles, and who has been invited. */
export default function TeamPage() {
  const allowed = useCan('platform.members.manage');
  return <div className="flex flex-col gap-stack">{allowed ? <TeamView /> : <Cannot />}</div>;
}
