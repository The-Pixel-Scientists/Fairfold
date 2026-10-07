// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Team. Who can sign in to the funder's console, with which
// roles, and whether multi-factor authentication protects them. Granting or
// changing a role asks the person to confirm it is them (ADR 0010).

import {
  Button,
  CheckboxGroup,
  DataTable,
  Dialog,
  FormField,
  Input,
  PageHeader,
  RadioGroup,
  StepUpDialog,
  Tag,
} from '@pixel-scientists/ui';
import type { Column, SortState } from '@pixel-scientists/ui';
import { useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { formatWhen } from './format.ts';
import { checkIdentity } from './identity.ts';
import { Eyebrow, Icon, Notice } from './parts.tsx';

type Role = 'Owner' | 'Administrator' | 'Programme manager' | 'Reviewer';

interface Member {
  id: string;
  /** Null until an invited person has set up their account. */
  name: string | null;
  email: string;
  roles: readonly Role[];
  mfa: boolean;
  /** `2027-04-02T09:20`, or null if they have not signed in yet. */
  lastSignedIn: string | null;
}

/** A change to who can do what, held until the person has confirmed it is them. */
type Pending =
  | { kind: 'invite'; email: string; role: Role }
  | { kind: 'roles'; member: Member; roles: readonly Role[] };

const roles: readonly { role: Role; can: string }[] = [
  {
    role: 'Owner',
    can: 'Full control, including who else is an owner. Every funder keeps at least one.',
  },
  {
    role: 'Administrator',
    can: 'Manages the team, settings and templates, exports data and reads the audit log.',
  },
  {
    role: 'Programme manager',
    can: 'Sets up programmes and rounds, assigns reviewers, records decisions and releases them.',
  },
  {
    role: 'Reviewer',
    can: 'Scores the applications assigned to them. Reviews are blind, so they never see applicant names or due diligence.',
  },
];

const members: readonly Member[] = [
  {
    id: 'ada',
    name: 'Ada Morgan',
    email: 'ada.morgan@northfield.example',
    roles: ['Owner'],
    mfa: true,
    lastSignedIn: '2027-04-02T08:52',
  },
  {
    id: 'marcus',
    name: 'Marcus Bell',
    email: 'marcus.bell@northfield.example',
    roles: ['Administrator', 'Programme manager'],
    mfa: true,
    lastSignedIn: '2027-04-02T09:20',
  },
  {
    id: 'sunita',
    name: 'Sunita Rao',
    email: 'sunita.rao@northfield.example',
    roles: ['Programme manager'],
    mfa: true,
    lastSignedIn: '2027-03-31T09:03',
  },
  {
    id: 'priya',
    name: 'Priya Shah',
    email: 'priya.shah@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-26T15:44',
  },
  {
    id: 'tom',
    name: 'Tom Okafor',
    email: 'tom.okafor@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-24T11:20',
  },
  {
    id: 'hannah',
    name: 'Hannah Lewis',
    email: 'hannah.lewis@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-24T16:02',
  },
  {
    id: 'daniel',
    name: 'Daniel Price',
    email: 'daniel.price@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-24T17:38',
  },
  {
    id: 'grace',
    name: 'Grace Mbeki',
    email: 'grace.mbeki@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-26T10:58',
  },
  {
    id: 'owen',
    name: 'Owen Hughes',
    email: 'owen.hughes@example.org',
    roles: ['Reviewer'],
    mfa: true,
    lastSignedIn: '2027-03-26T14:10',
  },
  {
    id: 'fatima',
    name: null,
    email: 'fatima.noor@example.org',
    roles: ['Reviewer'],
    mfa: false,
    lastSignedIn: null,
  },
];

interface MemberActions {
  onChangeRoles: (member: Member) => void;
  onResend: (member: Member) => void;
}

const columnsFor = ({ onChangeRoles, onResend }: MemberActions): readonly Column<Member>[] => [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    rowHeader: true,
    cell: (member) =>
      member.name === null ? (
        <span className="flex items-center gap-2 font-normal text-muted">
          Not joined yet <Tag>Invited</Tag>
        </span>
      ) : (
        member.name
      ),
  },
  { key: 'email', header: 'Email', cell: (member) => member.email },
  {
    key: 'roles',
    header: 'Roles',
    cell: (member) => (
      <span className="flex flex-wrap gap-1">
        {member.roles.map((role) => (
          <Tag key={role}>{role}</Tag>
        ))}
      </span>
    ),
  },
  {
    key: 'mfa',
    header: (
      <>
        MFA<span className="sr-only"> (multi-factor authentication)</span>
      </>
    ),
    cell: (member) =>
      member.lastSignedIn === null ? (
        <span className="text-muted">Not set up yet</span>
      ) : member.mfa ? (
        <span className="inline-flex items-center gap-1.5">
          <Icon name="check" className="text-success" />
          On
        </span>
      ) : (
        <Tag tone="warning">Off</Tag>
      ),
  },
  {
    key: 'lastSignedIn',
    header: 'Last signed in',
    sortable: true,
    cell: (member) =>
      member.lastSignedIn === null ? (
        <span className="text-muted">Not yet</span>
      ) : (
        formatWhen(member.lastSignedIn)
      ),
  },
  {
    key: 'actions',
    header: <span className="sr-only">Actions</span>,
    align: 'end',
    cell: (member) =>
      member.name === null ? (
        <Button
          variant="quiet"
          onClick={() => {
            onResend(member);
          }}
        >
          Resend invitation<span className="sr-only"> to {member.email}</span>
        </Button>
      ) : (
        <Button
          variant="quiet"
          onClick={() => {
            onChangeRoles(member);
          }}
        >
          Change roles<span className="sr-only"> for {member.name}</span>
        </Button>
      ),
  },
];

/** Sorted by the column, with people who have not joined yet always last. */
function sortMembers(rows: readonly Member[], { key, direction }: SortState): Member[] {
  const value = (member: Member) =>
    key === 'name' ? (member.name ?? '') : (member.lastSignedIn ?? '');
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) =>
    a.name === null || b.name === null
      ? Number(a.name === null) - Number(b.name === null)
      : sign * value(a).localeCompare(value(b)),
  );
}

const roleOptions = roles.map(({ role, can }) => ({ value: role, label: role, hint: can }));
const roleChoices = roles.map(({ role, can }) => ({
  value: role,
  label: (
    <>
      {role}
      <span className="block text-sm text-muted">{can}</span>
    </>
  ),
}));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Team() {
  const [people, setPeople] = useState<readonly Member[]>(members);
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'ascending' });
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Reviewer');
  const [error, setError] = useState<string>();
  const [changing, setChanging] = useState<Member>();
  const [chosen, setChosen] = useState<readonly Role[]>([]);
  const [chosenError, setChosenError] = useState<string>();
  const [pending, setPending] = useState<Pending>();
  const [message, setMessage] = useState('');
  const emailInput = useRef<HTMLInputElement>(null);

  const waiting = people.filter((person) => person.name === null).length;
  const count = (role: Role) => {
    const has = (person: Member) => person.roles.includes(role);
    const joined = people.filter((person) => person.name !== null && has(person)).length;
    const invited = people.filter((person) => person.name === null && has(person)).length;
    const joinedText = `${String(joined)} ${joined === 1 ? 'member' : 'members'}`;
    return invited > 0 ? `${joinedText}, ${String(invited)} invited` : joinedText;
  };

  function closeInvite(open: boolean) {
    setInviting(open);
    if (!open) setError(undefined);
  }

  function closeRoles(open: boolean) {
    if (open) return;
    setChanging(undefined);
    setChosenError(undefined);
  }

  function invite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setError('Enter an email address, like name@example.org.');
      emailInput.current?.focus();
      return;
    }
    closeInvite(false);
    setPending({ kind: 'invite', email: address, role });
  }

  function changeRoles(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changing === undefined) return;
    if (chosen.length === 0) {
      setChosenError('Choose at least one role.');
      event.currentTarget.querySelector('input')?.focus();
      return;
    }
    closeRoles(false);
    setPending({ kind: 'roles', member: changing, roles: chosen });
  }

  function apply(change: Pending) {
    if (change.kind === 'invite') {
      setPeople((current) => [
        ...current,
        {
          id: change.email,
          name: null,
          email: change.email,
          roles: [change.role],
          mfa: false,
          lastSignedIn: null,
        },
      ]);
      setMessage(`Invitation sent to ${change.email}. It works for 7 days.`);
      setEmail('');
      return;
    }
    setPeople((current) =>
      current.map((person) =>
        person.id === change.member.id ? { ...person, roles: change.roles } : person,
      ),
    );
    setMessage(`Roles changed for ${change.member.name ?? ''}: ${change.roles.join(', ')}.`);
  }

  const columns = columnsFor({
    onChangeRoles: (member) => {
      setChosen(member.roles);
      setChanging(member);
    },
    onResend: (member) => {
      setMessage(`Invitation sent again to ${member.email}. It works for 7 days.`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Eyebrow>
            <span>Northfield Foundation</span>
          </Eyebrow>
        }
        title="Team"
        description={`${String(people.length - waiting)} people can sign in to the console${waiting > 0 ? `, and ${String(waiting)} ${waiting === 1 ? 'invitation is' : 'invitations are'} waiting` : ''}. Roles decide what each person sees and does.`}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setInviting(true);
            }}
          >
            Invite someone
          </Button>
        }
      />

      <Notice icon="lock" title="Multi-factor authentication is required for everyone">
        New members set it up the first time they sign in.
      </Notice>

      <section aria-labelledby="members" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="members" className="text-lg font-semibold tracking-tight text-ink">
            Members
          </h2>
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted">
            {message !== '' && <Icon name="check" className="text-success" />}
            {message}
          </p>
        </div>
        <DataTable
          caption="Members of Northfield Foundation"
          captionHidden
          columns={columns}
          rows={sortMembers(people, sort)}
          rowKey={(member) => member.id}
          sort={sort}
          onSortChange={setSort}
        />
      </section>

      <section aria-labelledby="roles" className="flex flex-col gap-3">
        <h2 id="roles" className="text-lg font-semibold tracking-tight text-ink">
          What each role can do
        </h2>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          {roles.map(({ role: name, can }) => (
            <div key={name} className="flex flex-col gap-1 border-t border-divider pt-3">
              <dt className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {name}
                <span className="text-sm font-normal text-muted">{count(name)}</span>
              </dt>
              <dd className="text-body text-muted">{can}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Dialog
        open={inviting}
        onOpenChange={closeInvite}
        title="Invite someone"
        description="They get an email with a link to set up their account. The link works for 7 days."
        actions={
          <>
            <Button
              onClick={() => {
                closeInvite(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="invite" variant="primary">
              Send invitation
            </Button>
          </>
        }
      >
        <form id="invite" noValidate onSubmit={invite} className="flex flex-col gap-4">
          <FormField label="Email address" error={error}>
            <Input
              ref={emailInput}
              data-autofocus
              type="email"
              name="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
              }}
            />
          </FormField>
          <RadioGroup
            legend="Role"
            name="role"
            value={role}
            onValueChange={(value) => {
              setRole(value as Role);
            }}
            options={roleOptions}
          />
        </form>
      </Dialog>

      <Dialog
        open={changing !== undefined}
        onOpenChange={closeRoles}
        title={`Change roles for ${changing?.name ?? ''}`}
        description="Roles take effect the next time they open the console."
        actions={
          <>
            <Button
              onClick={() => {
                closeRoles(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="change-roles" variant="primary">
              Save roles
            </Button>
          </>
        }
      >
        <form id="change-roles" noValidate onSubmit={changeRoles} className="flex flex-col gap-4">
          <CheckboxGroup
            legend="Roles"
            name="roles"
            values={chosen}
            onValuesChange={(values) => {
              setChosen(values as Role[]);
              setChosenError(undefined);
            }}
            options={roleChoices}
            error={chosenError}
          />
        </form>
      </Dialog>

      <StepUpDialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
        onConfirm={async (credentials) => {
          checkIdentity(credentials);
          await Promise.resolve();
          if (pending !== undefined) apply(pending);
        }}
      />
    </div>
  );
}
