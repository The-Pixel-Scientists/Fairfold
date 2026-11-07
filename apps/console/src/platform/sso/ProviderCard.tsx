// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  ErrorSummary,
  FormField,
  Input,
  Tag,
  formText,
  useSubmit,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { CopyValue } from './CopyValue.tsx';
import type { DnsRecord, Domain, Provider } from './change.ts';
import { useFocusFirst } from './useFocusFirst.ts';

export interface ProviderActions {
  change: (provider: Provider) => void;
  remove: (provider: Provider) => void;
  /** Asks the person to confirm it is them before the domain field shows. True when they have. */
  openDomain: () => Promise<boolean>;
  addDomain: (provider: Provider, domain: string) => Promise<void>;
  verify: (provider: Provider, domain: Domain) => Promise<void>;
  removeDomain: (provider: Provider, domain: Domain) => void;
}

function Registration({ provider }: { provider: Provider }) {
  return (
    <dl className="flex flex-col gap-2">
      {provider.kind === 'oidc' ? (
        <CopyValue label="Redirect URI" value={provider.redirectUri} />
      ) : (
        <>
          <CopyValue label="Service provider entity ID" value={provider.sp.entityId} />
          <CopyValue label="ACS URL" value={provider.sp.acsUrl} />
        </>
      )}
    </dl>
  );
}

function mfaText(provider: Provider): string {
  const values =
    provider.kind === 'oidc' ? [...provider.mfa.amr, ...provider.mfa.acr] : provider.mfaContexts;
  return values.length === 0
    ? 'Staff enter a code from their authenticator app as well.'
    : `MFA reported by the provider counts: ${values.join(', ')}.`;
}

function DnsInstructions({ record }: { record: DnsRecord }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-divider bg-sunken p-3">
      <p className="text-body font-medium text-ink">Publish this DNS record</p>
      <ol className="list-decimal pl-5 text-body text-muted">
        <li>Add a {record.type} record with this name and value at your DNS host.</li>
        <li>Wait for DNS to update, which can take a few minutes.</li>
        <li>Choose Verify domain.</li>
      </ol>
      <dl className="flex flex-col gap-2">
        <CopyValue label="Record name" value={record.name} />
        <CopyValue label="Record value" value={record.value} />
      </dl>
    </div>
  );
}

function DomainRow({
  provider,
  domain,
  record,
  actions,
}: {
  provider: Provider;
  domain: Domain;
  record: DnsRecord | undefined;
  actions: ProviderActions;
}) {
  const verified = domain.status === 'verified';
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-body font-medium text-ink">
          {domain.domain}
          <Tag tone={verified ? 'success' : 'warning'}>
            {verified ? 'Verified' : 'Waiting for verification'}
          </Tag>
        </span>
        <span className="flex gap-2">
          {!verified && (
            <Button
              aria-label={`Verify domain ${domain.domain}`}
              onClick={() => {
                void actions.verify(provider, domain);
              }}
            >
              Verify domain
            </Button>
          )}
          <Button
            variant="danger"
            aria-label={`Remove domain ${domain.domain}`}
            onClick={() => {
              actions.removeDomain(provider, domain);
            }}
          >
            Remove domain
          </Button>
        </span>
      </div>
      {!verified && record !== undefined && <DnsInstructions record={record} />}
    </li>
  );
}

function AddDomain({
  provider,
  actions,
  onDone,
}: {
  provider: Provider;
  actions: ProviderActions;
  onDone: () => void;
}) {
  const form = useSubmit(['domain'], async (data) => {
    await actions.addDomain(provider, formText(data, 'domain'));
    onDone();
  });
  const first = useFocusFirst();
  return (
    <form
      ref={first}
      noValidate
      onSubmit={form.onSubmit}
      aria-label={`Add domain to ${provider.name}`}
      className="flex flex-col gap-3"
    >
      <ErrorSummary key={form.attempt} errors={form.errors} />
      <FormField
        label="Email domain"
        id={`domain-${provider.id}`}
        hint="The part of staff email addresses after the @, for example example.org."
        error={form.errorFor('domain')}
      >
        <Input name="domain" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          Add domain
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function ProviderCard({
  provider,
  records,
  actions,
}: {
  provider: Provider;
  records: Readonly<Record<string, DnsRecord>>;
  actions: ProviderActions;
}) {
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  // The form that held focus has gone, so focus goes back to the button that opened it.
  useEffect(() => {
    if (adding || !closed.current) return;
    closed.current = false;
    addButton.current?.focus();
  }, [adding]);

  return (
    <section
      aria-label={provider.name}
      className="flex flex-col gap-4 rounded-lg border border-divider bg-surface p-gutter"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
          {provider.name} <Tag tone="info">{provider.kind === 'oidc' ? 'OIDC' : 'SAML'}</Tag>
        </h3>
        <span className="flex gap-2">
          <Button
            aria-label={`Change provider ${provider.name}`}
            onClick={() => {
              actions.change(provider);
            }}
          >
            Change provider
          </Button>
          <Button
            variant="danger"
            aria-label={`Remove provider ${provider.name}`}
            onClick={() => {
              actions.remove(provider);
            }}
          >
            Remove provider
          </Button>
        </span>
      </div>
      <p className="text-body text-muted">{mfaText(provider)}</p>
      <div className="flex flex-col gap-2">
        <h4 className="text-body font-semibold text-ink">Register with your provider</h4>
        <Registration provider={provider} />
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-body font-semibold text-ink">Email domains</h4>
        {provider.domains.length === 0 ? (
          <p className="text-body text-muted">
            No domains yet. Add the email domain your staff use, then publish the DNS record to
            prove it is yours.
          </p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-divider">
            {provider.domains.map((domain) => (
              <DomainRow
                key={domain.id}
                provider={provider}
                domain={domain}
                record={records[domain.id]}
                actions={actions}
              />
            ))}
          </ul>
        )}
        {adding ? (
          <AddDomain
            provider={provider}
            actions={actions}
            onDone={() => {
              closed.current = true;
              setAdding(false);
            }}
          />
        ) : (
          <div>
            <Button
              ref={addButton}
              onClick={() => {
                void actions.openDomain().then((ready) => {
                  if (ready) setAdding(true);
                });
              }}
            >
              Add domain
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
