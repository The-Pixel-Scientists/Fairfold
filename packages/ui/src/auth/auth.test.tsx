// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../Button.tsx';
import { ErrorSummary } from '../ErrorSummary.tsx';
import { FormField, Input } from '../FormField.tsx';
import { AuthenticatorKey } from './AuthenticatorKey.tsx';
import { asProblem, formText } from './problems.ts';
import { StepUpDialog } from './StepUpDialog.tsx';
import { useSubmit } from './useSubmit.ts';

afterEach(cleanup);

/** The shape of the domain package's ProblemError, without importing it. */
class Failure extends Error {
  readonly status: number;
  readonly detail: string;
  readonly errors: readonly { field: string; message: string }[];

  constructor(status: number, detail: string, errors: { field: string; message: string }[] = []) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

describe('asProblem', () => {
  it('reads a problem, and nothing else', () => {
    const failure = new Failure(400, 'Fix the fields.', [
      { field: 'body.email', message: 'Enter an email address.' },
    ]);
    expect(asProblem(failure)).toEqual({
      status: 400,
      detail: 'Fix the fields.',
      errors: [{ field: 'body.email', message: 'Enter an email address.' }],
    });
    expect(asProblem(new Error('A mistake in our code.'))).toBeNull();
    expect(asProblem('text')).toBeNull();
    expect(asProblem(null)).toBeNull();
  });

  it('leaves out entries that are not a field and a message', () => {
    const odd = { status: 400, detail: 'Fix it.', errors: [{ field: 1 }, 'text', null] };
    expect(asProblem(odd)?.errors).toEqual([]);
  });
});

describe('formText', () => {
  it('reads typed text, and an empty string for anything else', () => {
    const data = new FormData();
    data.set('email', 'ada@example.org');
    data.set('file', new Blob(['x']), 'x.txt');
    expect(formText(data, 'email')).toBe('ada@example.org');
    expect(formText(data, 'file')).toBe('');
    expect(formText(data, 'missing')).toBe('');
  });
});

function Form({ action }: { action: (data: FormData) => Promise<void> }) {
  const form = useSubmit(['email', 'password'], action);
  return (
    <form noValidate onSubmit={form.onSubmit}>
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField id="email" label="Email address" error={form.errorFor('email')}>
        <Input name="email" />
      </FormField>
      <FormField id="password" label="Password" error={form.errorFor('password')}>
        <Input name="password" type="password" />
      </FormField>
      <Button type="submit" aria-disabled={form.pending || undefined}>
        Sign in
      </Button>
    </form>
  );
}

describe('useSubmit', () => {
  it('gives the action what was typed, and shows nothing when it succeeds', async () => {
    const user = userEvent.setup();
    const action = vi.fn((data: FormData) => {
      expect(formText(data, 'email')).toBe('ada@example.org');
      return Promise.resolve();
    });
    render(<Form action={action} />);

    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts each field problem beside its field and in the summary, with focus on the summary', async () => {
    const user = userEvent.setup();
    const action = () =>
      Promise.reject(
        new Failure(400, 'Fix the fields.', [
          { field: 'body.email', message: 'Enter an email address in the correct format.' },
          { field: 'body.password', message: 'Enter your password.' },
        ]),
      );
    render(<Form action={action} />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const summary = await screen.findByRole('alert', { name: 'There is a problem' });
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Enter an email address in the correct format.',
      'Enter your password.',
    ]);
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).getAttribute('aria-describedby'),
    ).toBeTruthy();
  });

  it('puts a problem with the whole form in the summary, linked to the first field, and beside no field', async () => {
    const user = userEvent.setup();
    render(
      <Form
        action={() =>
          Promise.reject(new Failure(401, 'The email address or password is not right.'))
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const link = await screen.findByRole('link', {
      name: 'The email address or password is not right.',
    });
    expect(link.getAttribute('href')).toBe('#email');
    expect(
      screen.getByRole('textbox', { name: 'Email address' }).hasAttribute('aria-invalid'),
    ).toBe(false);
  });

  it('treats a field the form does not have as a problem with the whole form', async () => {
    const user = userEvent.setup();
    render(
      <Form
        action={() =>
          Promise.reject(
            new Failure(400, 'Fix the fields.', [
              { field: 'body.token', message: 'This link is not valid.' },
            ]),
          )
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      (await screen.findByRole('link', { name: 'This link is not valid.' })).getAttribute('href'),
    ).toBe('#email');
  });

  it('says something went wrong, without detail, for a mistake in our own code', async () => {
    const user = userEvent.setup();
    render(<Form action={() => Promise.reject(new TypeError('x is undefined'))} />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('link', { name: 'Something went wrong. Try again.' }),
    ).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('runs once while it is running, and keeps focus on the button', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Form action={action} />);
    const button = screen.getByRole('button', { name: 'Sign in' });

    await user.click(button);
    await user.click(button);
    await user.keyboard('{Enter}');

    expect(action).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);

    finish();
    await waitFor(() => {
      expect(button.hasAttribute('aria-disabled')).toBe(false);
    });
  });

  it('moves focus to the summary again on each failed attempt', async () => {
    const user = userEvent.setup();
    render(<Form action={() => Promise.reject(new Failure(401, 'Not right.'))} />);
    const button = screen.getByRole('button', { name: 'Sign in' });

    await user.click(button);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('alert'));
    });
    button.focus();
    await user.click(button);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('alert'));
    });
  });
});

describe('StepUpDialog', () => {
  function open(onConfirm = vi.fn(() => Promise.resolve())) {
    const onOpenChange = vi.fn();
    render(<StepUpDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    return { onConfirm, onOpenChange };
  }

  it('asks for the password and the code, and says why', async () => {
    open();

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' });
    expect(dialog.textContent).toContain('needs a recent check');
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    const code = screen.getByLabelText('Code from your authenticator app');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    await waitFor(() => {
      expect(document.activeElement).toBe(password);
    });
  });

  it('confirms with what was typed, then closes', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = open();

    await user.type(await screen.findByLabelText('Password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm it is you' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onConfirm).toHaveBeenCalledWith({ password: 'correct horse battery', code: '123456' });
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup();
    const { onConfirm } = open();
    await screen.findByLabelText('Password');

    await user.keyboard('correct horse battery{Tab}123456{Enter}');

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  it('shows what went wrong, and stays open', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = open(
      vi.fn(() =>
        Promise.reject(
          new Failure(401, 'Your password or code is not right. Check them and try again.'),
        ),
      ),
    );

    await user.click(await screen.findByRole('button', { name: 'Confirm it is you' }));

    expect(
      await screen.findByRole('link', {
        name: 'Your password or code is not right. Check them and try again.',
      }),
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('links each message to its field, with ids that cannot match the page behind it', async () => {
    const user = userEvent.setup();
    open(
      vi.fn(() =>
        Promise.reject(
          new Failure(400, 'Fix the fields.', [
            { field: 'body.code', message: 'Enter the 6-digit code from your authenticator app.' },
          ]),
        ),
      ),
    );

    await user.click(await screen.findByRole('button', { name: 'Confirm it is you' }));

    const link = await screen.findByRole('link', {
      name: 'Enter the 6-digit code from your authenticator app.',
    });
    expect(link.getAttribute('href')).toBe('#step-up-code');
    expect(screen.getByLabelText('Code from your authenticator app').id).toBe('step-up-code');
    expect(screen.getByLabelText('Password').id).toBe('step-up-password');
  });

  it('cancels', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = open();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('AuthenticatorKey', () => {
  const uri = 'otpauth://totp/Northfield:ada@example.org?secret=JBSWY3DPEHPK3PXP&issuer=Northfield';

  it('shows the key as text in groups, and a link that opens the app', () => {
    render(<AuthenticatorKey secret="JBSWY3DPEHPK3PXP" uri={uri} />);

    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open in your authenticator app' }).getAttribute('href'),
    ).toBe(uri);
  });

  it('shows the key and no link when the address is not an authenticator address', () => {
    render(<AuthenticatorKey secret="JBSWY3DPEHPK3PXP" uri="javascript:alert(1)" />);

    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
