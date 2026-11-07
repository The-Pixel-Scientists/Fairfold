// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form to add or change an OIDC or SAML provider. A client secret or
// certificate lives in the form while it is open and nowhere else: not in
// the address, history, storage or an attribute. The browser's own file
// reader turns a chosen certificate file into text for the field.

import { ProblemError } from '@pixel-scientists/domain/api';
import type { CallInput } from '@pixel-scientists/domain/api';
import type { changeSsoProvider } from '@pixel-scientists/domain/auth';
import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  RadioGroup,
  Textarea,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { certificatesIn, linesOf, onFormFields } from './change.ts';
import type { Provider } from './change.ts';
import { useFocusFirst } from './useFocusFirst.ts';

export type ProviderBody = CallInput<typeof changeSsoProvider>['body'];

export interface ProviderFormProps {
  kind: 'oidc' | 'saml';
  /** The provider being changed, or null when adding one. */
  provider: Provider | null;
  /** Saves it, then the page closes the form. Throws the API's problem. */
  save: (body: ProviderBody) => Promise<void>;
  onCancel: () => void;
}

const OIDC_FIELDS = ['name', 'issuer', 'clientId', 'clientSecret', 'amr', 'acr'] as const;
const SAML_FIELDS = ['name', 'entityId', 'ssoUrl', 'certificates', 'mfaContexts'] as const;

const noValues = 'Enter at least one value that counts as MFA, or choose to ask for a code here.';

/** Reads a chosen file as text in the browser. Nothing is uploaded. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('The file could not be read.'));
    };
    reader.readAsText(file);
  });
}

function refuse(field: string, message: string): ProblemError {
  return new ProblemError(400, message, { errors: [{ field: `body.${field}`, message }] });
}

/** The values the provider counts as MFA, by the name of the field that holds them. */
function savedValues(provider: Provider | null): Record<string, readonly string[]> {
  if (provider?.kind === 'oidc') return { amr: provider.mfa.amr, acr: provider.mfa.acr };
  if (provider?.kind === 'saml') return { mfaContexts: provider.mfaContexts };
  return {};
}

function Mfa({
  kind,
  provider,
  errorFor,
}: {
  kind: 'oidc' | 'saml';
  provider: Provider | null;
  errorFor: (field: string) => string | undefined;
}) {
  const saved = savedValues(provider);
  const trusting = Object.values(saved).some((values) => values.length > 0);
  const [choice, setChoice] = useState(provider === null || trusting ? 'trust' : 'local');
  const area = (name: string, label: string, hint: string) => (
    <FormField label={label} hint={hint} id={name} error={errorFor(name)}>
      <Textarea
        name={name}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        defaultValue={(saved[name] ?? []).join('\n')}
      />
    </FormField>
  );

  return (
    <>
      <RadioGroup
        legend="Multi-factor authentication"
        name="mfa"
        id="mfa"
        value={choice}
        onValueChange={setChoice}
        hint="Staff who have MFA from neither this provider nor this service cannot finish signing in."
        options={[
          {
            value: 'trust',
            label: 'Trust MFA reported by this provider',
            hint: 'Staff who used MFA at the provider are not asked for a code here.',
          },
          {
            value: 'local',
            label: 'Ask for a code from this service as well',
            hint: 'Staff always enter a code from their authenticator app after the provider.',
          },
        ]}
      />
      {choice === 'trust' &&
        (kind === 'oidc' ? (
          <>
            {area(
              'amr',
              'Values of amr that count as MFA',
              'One value to a line, for example mfa.',
            )}
            {area(
              'acr',
              'Values of acr that count as MFA',
              'One value to a line. Optional if you set amr.',
            )}
          </>
        ) : (
          area(
            'mfaContexts',
            'AuthnContextClassRef values that count as MFA',
            'One value to a line.',
          )
        ))}
    </>
  );
}

function CertificateField({
  provider,
  error,
}: {
  provider: Provider | null;
  error: string | undefined;
}) {
  const [text, setText] = useState('');
  const [fileProblem, setFileProblem] = useState<string | undefined>(undefined);
  const prints = provider?.kind === 'saml' ? provider.certificates : [];

  return (
    <div className="flex flex-col gap-3">
      <FormField
        label="Identity provider signing certificate"
        id="certificates"
        error={error}
        hint={
          prints.length > 0
            ? `Saved: ${prints.map(({ sha256 }) => `SHA-256 ${sha256}`).join('; ')}. Paste the certificate again to save a change.`
            : 'Paste the certificate in PEM form, from BEGIN CERTIFICATE to END CERTIFICATE.'
        }
      >
        <Textarea
          name="certificates"
          rows={5}
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
      </FormField>
      {/* Outside the field above, so it keeps its own id, label and description. */}
      <div className="flex flex-col gap-field-gap">
        <label htmlFor="certificate-file" className="text-body font-medium text-ink">
          Or choose a certificate file
        </label>
        <p id="certificate-file-hint" className="text-body text-muted">
          A .pem, .crt or .cer file under 16 KB. It is read in your browser and not uploaded.
        </p>
        {fileProblem !== undefined && (
          <p id="certificate-file-error" role="alert" className="text-body font-medium text-danger">
            <span className="sr-only">Error:</span> {fileProblem}
          </p>
        )}
        <Input
          type="file"
          id="certificate-file"
          aria-describedby={
            fileProblem === undefined
              ? 'certificate-file-hint'
              : 'certificate-file-hint certificate-file-error'
          }
          aria-invalid={fileProblem === undefined ? undefined : true}
          accept=".pem,.crt,.cer,.txt"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setFileProblem(undefined);
            if (file === undefined) return;
            if (file.size > 16_384) {
              setFileProblem('Choose a certificate file under 16 KB.');
              return;
            }
            readText(file).then(setText, () => {
              setFileProblem('The file could not be read. Paste the certificate instead.');
            });
          }}
        />
      </div>
    </div>
  );
}

export function ProviderForm({ kind, provider, save, onCancel }: ProviderFormProps) {
  const changing = provider !== null;
  const oidc = provider?.kind === 'oidc' ? provider : null;
  const saml = provider?.kind === 'saml' ? provider : null;

  const form = useSubmit(kind === 'oidc' ? OIDC_FIELDS : SAML_FIELDS, async (data) => {
    const name = formText(data, 'name');
    const trust = formText(data, 'mfa') !== 'local';
    let body: ProviderBody;
    if (kind === 'oidc') {
      const amr = trust ? linesOf(formText(data, 'amr')) : [];
      const acr = trust ? linesOf(formText(data, 'acr')) : [];
      if (trust && amr.length + acr.length === 0) throw refuse('amr', noValues);
      const secret = formText(data, 'clientSecret');
      body = {
        kind: 'oidc',
        name,
        issuer: formText(data, 'issuer').trim(),
        clientId: formText(data, 'clientId'),
        ...(secret === '' ? {} : { clientSecret: secret }),
        mfa: { amr, acr },
      };
    } else {
      const mfaContexts = trust ? linesOf(formText(data, 'mfaContexts')) : [];
      if (trust && mfaContexts.length === 0) throw refuse('mfaContexts', noValues);
      body = {
        kind: 'saml',
        name,
        entityId: formText(data, 'entityId'),
        ssoUrl: formText(data, 'ssoUrl').trim(),
        certificates: certificatesIn(formText(data, 'certificates')),
        mfaContexts,
      };
    }
    try {
      await save(body);
    } catch (error) {
      throw onFormFields(error);
    }
  });

  const label = kind === 'oidc' ? 'OIDC' : 'SAML';
  const first = useFocusFirst();

  return (
    <form
      ref={first}
      noValidate
      onSubmit={form.onSubmit}
      aria-label={`${changing ? 'Change' : 'Add'} ${label} provider`}
      className="flex flex-col gap-4 rounded-lg border border-divider bg-surface p-gutter"
    >
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField label="Display name" id="name" error={form.errorFor('name')}>
        <Input name="name" autoComplete="off" defaultValue={provider?.name ?? ''} />
      </FormField>
      {kind === 'oidc' ? (
        <>
          <FormField
            label="Issuer or discovery URL"
            id="issuer"
            hint="An https address, for example https://login.example.org."
            error={form.errorFor('issuer')}
          >
            <Input
              name="issuer"
              type="url"
              autoComplete="off"
              spellCheck={false}
              defaultValue={oidc?.issuer ?? ''}
            />
          </FormField>
          <FormField label="Client ID" id="clientId" error={form.errorFor('clientId')}>
            <Input
              name="clientId"
              autoComplete="off"
              spellCheck={false}
              defaultValue={oidc?.clientId ?? ''}
            />
          </FormField>
          <FormField
            label="Client secret"
            id="clientSecret"
            hint={
              changing
                ? 'A client secret is saved. Leave this blank to keep it, or enter a new one.'
                : undefined
            }
            error={form.errorFor('clientSecret')}
          >
            <Input name="clientSecret" type="password" autoComplete="off" spellCheck={false} />
          </FormField>
        </>
      ) : (
        <>
          <FormField
            label="Identity provider entity ID"
            id="entityId"
            error={form.errorFor('entityId')}
          >
            <Input
              name="entityId"
              autoComplete="off"
              spellCheck={false}
              defaultValue={saml?.entityId ?? ''}
            />
          </FormField>
          <FormField
            label="Single sign-on URL"
            id="ssoUrl"
            hint="An https address."
            error={form.errorFor('ssoUrl')}
          >
            <Input
              name="ssoUrl"
              type="url"
              autoComplete="off"
              spellCheck={false}
              defaultValue={saml?.ssoUrl ?? ''}
            />
          </FormField>
          <CertificateField provider={provider} error={form.errorFor('certificates')} />
        </>
      )}
      <Mfa kind={kind} provider={provider} errorFor={form.errorFor} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          {changing ? 'Save provider' : `Add ${label} provider`}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
