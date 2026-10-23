// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Member } from '@pixel-scientists/domain/platform/team';
import type { Role } from '@pixel-scientists/domain/platform';
import {
  Button,
  CheckboxGroup,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  useSubmit,
} from '@pixel-scientists/ui';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { displayName } from './change.ts';
import type { Change } from './change.ts';
import { roleChoices } from './roleChoices.tsx';

/** What every dialog is given by the page. */
export interface DialogProps {
  /** Makes the change, and closes the dialog when it works. Throws what went wrong. */
  run: (change: Change) => Promise<void>;
  onClose: () => void;
  /** Steps aside, with what was typed kept, while the person confirms it is them. */
  hidden: boolean;
}

interface FrameProps extends DialogProps {
  title: string;
  description: ReactNode;
  submit: string;
  danger?: boolean;
  fields: readonly string[];
  /** The change the form makes. */
  change: () => Change;
  children?: (form: ReturnType<typeof useSubmit>) => ReactNode;
}

/** One form in a dialog: the error summary, the fields, Cancel, and a button that says what happens. */
function Frame({
  title,
  description,
  submit,
  danger = false,
  fields,
  change,
  children,
  run,
  onClose,
  hidden,
}: FrameProps) {
  const id = useId();
  const form = useSubmit(fields, () => run(change()));
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

export function InviteDialog(props: DialogProps) {
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <Frame
      {...props}
      title="Invite someone"
      description="They get an email with a link to join the team. The link works for 7 days."
      submit="Send invitation"
      fields={['email', 'roles']}
      // The route's contract checks both before anything is sent, and the form shows what is wrong.
      change={() => ({ kind: 'invite', email: email.trim(), roles: chosen as Role[] })}
    >
      {(form) => (
        <>
          <FormField label="Email address" id="email" error={form.errorFor('email')}>
            <Input
              data-autofocus
              type="email"
              name="email"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
              }}
            />
          </FormField>
          <CheckboxGroup
            legend="Roles"
            id="roles"
            name="roles"
            hint="Choose every role this person needs."
            values={chosen}
            onValuesChange={setChosen}
            options={roleChoices}
            error={form.errorFor('roles')}
          />
        </>
      )}
    </Frame>
  );
}

export function RolesDialog({ member, ...props }: DialogProps & { member: Member }) {
  const [chosen, setChosen] = useState<string[]>([...member.roles]);
  return (
    <Frame
      {...props}
      title={`Change roles for ${displayName(member)}`}
      description="Choose every role they need. Their access changes as soon as you save."
      submit="Save roles"
      fields={['roles']}
      change={() => ({ kind: 'roles', member, roles: chosen as Role[] })}
    >
      {(form) => (
        <CheckboxGroup
          legend="Roles"
          id="roles"
          name="roles"
          values={chosen}
          onValuesChange={setChosen}
          options={roleChoices}
          error={form.errorFor('roles')}
        />
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
  ...props
}: DialogProps & {
  title: string;
  description: ReactNode;
  submit: string;
  danger?: boolean;
  change: Change;
}) {
  return (
    <Frame
      {...props}
      title={title}
      description={description}
      submit={submit}
      {...(danger === undefined ? {} : { danger })}
      fields={[]}
      change={() => change}
    />
  );
}
