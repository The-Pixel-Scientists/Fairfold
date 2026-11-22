// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import type { TeamSummary } from '@pixel-scientists/domain/platform/team';
import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  Select,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { personName } from './teamChange.ts';
import type { Person, TeamChange } from './teamChange.ts';

/** What every dialog is given by the page. */
export interface TeamDialogProps {
  /** Makes the change, and closes the dialog when it works. Throws what went wrong. */
  run: (change: TeamChange) => Promise<void>;
  onClose: () => void;
  /** Steps aside, with what was typed kept, while the person confirms it is them. */
  hidden: boolean;
}

interface FrameProps extends Omit<TeamDialogProps, 'run'> {
  title: string;
  description: ReactNode;
  submit: string;
  danger?: boolean;
  fields: readonly string[];
  action: (data: FormData) => Promise<void>;
  children?: (form: ReturnType<typeof useSubmit>) => ReactNode;
}

/** One form in a dialog: the error summary, the fields, Cancel, and a button that says what happens. */
function Frame({
  title,
  description,
  submit,
  danger = false,
  fields,
  action,
  children,
  onClose,
  hidden,
}: FrameProps) {
  const id = useId();
  const form = useSubmit(fields, action);
  return (
    <Dialog
      open={!hidden}
      onOpenChange={(open) => {
        if (!open && !form.pending) onClose();
      }}
      title={title}
      description={description}
      actions={
        <>
          <Button onClick={onClose} data-autofocus={fields.length === 0 ? '' : undefined}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={id}
            variant={danger ? 'danger' : 'primary'}
            aria-disabled={form.pending || undefined}
          >
            {submit}
          </Button>
        </>
      }
    >
      <form id={id} noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        {fields.length === 0 ? (
          form.errors[0] !== undefined && (
            <p key={form.attempt} role="alert" className="text-body font-medium text-danger">
              {form.errors[0].message}
            </p>
          )
        ) : (
          <ErrorSummary key={form.attempt} errors={form.errors} />
        )}
        {children?.(form)}
      </form>
    </Dialog>
  );
}

const WHAT_A_TEAM_DOES =
  'A team decides which records its members can reach. It does not give anyone a permission; roles do that, on the Team page.';

/** Creates a team, or renames one when `team` is given. */
export function NameDialog({ team, run, ...props }: TeamDialogProps & { team?: TeamSummary }) {
  return (
    <Frame
      {...props}
      title={team === undefined ? 'Create team' : `Rename ${team.name}`}
      description={
        team === undefined
          ? `Choose a name people will recognise, such as Casework. ${WHAT_A_TEAM_DOES}`
          : 'Records assigned to this team stay assigned to it under the new name.'
      }
      submit={team === undefined ? 'Create team' : 'Rename team'}
      fields={['name']}
      action={(data) => {
        const name = formText(data, 'name').trim();
        return run(team === undefined ? { kind: 'create', name } : { kind: 'rename', team, name });
      }}
    >
      {(form) => (
        <FormField
          label="Team name"
          id="name"
          hint="Up to 100 characters."
          error={form.errorFor('name')}
        >
          <Input data-autofocus name="name" autoComplete="off" defaultValue={team?.name ?? ''} />
        </FormField>
      )}
    </Frame>
  );
}

/** A confirmation with nothing to fill in: it says what will happen, and the button does it. */
export function ConfirmDialog({
  title,
  description,
  submit,
  danger,
  change,
  run,
  ...props
}: TeamDialogProps & {
  title: string;
  description: ReactNode;
  submit: string;
  danger?: boolean;
  change: TeamChange;
}) {
  return (
    <Frame
      {...props}
      title={title}
      description={description}
      submit={submit}
      {...(danger === undefined ? {} : { danger })}
      fields={[]}
      action={() => run(change)}
    />
  );
}

export interface Candidate extends Person {
  /** The member's role labels, such as "Programme manager, Reviewer". */
  roles: string;
}

/** Chooses one member to add. Members are shown by name and role, never by email. */
export function AddMemberDialog({
  team,
  candidates,
  run,
  ...props
}: TeamDialogProps & { team: TeamSummary; candidates: readonly Candidate[] }) {
  return (
    <Frame
      {...props}
      title={`Add a member to ${team.name}`}
      description={`They will see records assigned to ${team.name}. Their permissions do not change.`}
      submit="Add member"
      fields={['membershipId']}
      action={(data) => {
        const chosen = candidates.find(
          ({ membershipId }) => membershipId === formText(data, 'membershipId'),
        );
        if (chosen === undefined) {
          const message = 'Choose a member to add.';
          throw new ProblemError(400, message, {
            errors: [{ field: 'membershipId', message }],
          });
        }
        return run({ kind: 'add', team, person: chosen });
      }}
    >
      {(form) =>
        candidates.length === 0 ? (
          <p className="text-muted">Everyone who can sign in is already in this team.</p>
        ) : (
          <FormField label="Member" id="membershipId" error={form.errorFor('membershipId')}>
            <Select data-autofocus name="membershipId" defaultValue="">
              <option value="" disabled>
                Choose a member
              </option>
              {candidates.map((person) => (
                <option key={person.membershipId} value={person.membershipId}>
                  {person.name ?? 'Not named yet'} ({person.roles})
                </option>
              ))}
            </Select>
          </FormField>
        )
      }
    </Frame>
  );
}

export const removeDescription = (team: TeamSummary, person: Person): string =>
  `${personName(person)} will no longer see records assigned to ${team.name}.`;
