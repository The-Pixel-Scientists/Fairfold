// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import type { CallInput } from '@pixel-scientists/domain/api';
import {
  addSsoDomain,
  addSsoProvider,
  changeSsoProvider,
  getSsoProvider,
  listSsoProviders,
  removeSsoDomain,
  removeSsoProvider,
  verifySsoDomain,
} from '@pixel-scientists/domain/auth';
import { messages } from '@pixel-scientists/domain/platform';
import {
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  WhenLoaded,
  asProblem,
  useLoad,
  useSession,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { callApi } from '../../api.ts';
import { SettingsSections } from '../settings/SettingsFrame.tsx';
import { STEP_UP_NEEDED } from '../team/change.ts';
import { useStepUp } from '../team/useStepUp.tsx';
import type { DnsRecord, Domain, Provider } from './change.ts';
import { ProviderCard } from './ProviderCard.tsx';
import type { ProviderActions } from './ProviderCard.tsx';
import { ProviderForm } from './ProviderForm.tsx';
import type { ProviderBody } from './ProviderForm.tsx';

const loadProviders = async (): Promise<Provider[]> => {
  const { providers } = await callApi(listSsoProviders, {});
  return Promise.all(
    providers.map(({ id }) => callApi(getSsoProvider, { params: { providerId: id } })),
  );
};

type AddBody = CallInput<typeof addSsoProvider>['body'];
type Open = { kind: 'oidc' | 'saml'; provider: Provider | null };
type Asking = { provider: Provider; domain: Domain | null };

const notFoundYet =
  'We could not find the DNS record yet. Check that its name and value match exactly, wait a few minutes for DNS to update, then verify again.';

function Providers({ initial }: { initial: Provider[] }) {
  const { state: session } = useSession();
  const stepUp = useStepUp();
  const [providers, setProviders] = useState(initial);
  const [records, setRecords] = useState<Record<string, DnsRecord>>({});
  const [open, setOpen] = useState<Open | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [message, setMessage] = useState({ text: '', count: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [closes, setCloses] = useState(0);

  // A form that held focus has closed: focus goes back to the button that opened it.
  useEffect(() => {
    if (closes === 0) return;
    const back = opener.current?.isConnected ? opener.current : heading.current;
    back?.focus();
  }, [closes]);

  // When what had focus has gone, focus goes to the list's heading.
  useEffect(() => {
    if (message.count === 0) return;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      heading.current?.focus();
    }
  }, [message.count]);

  const rememberOpener = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const closeForm = () => {
    setOpen(null);
    setCloses((count) => count + 1);
  };

  const say = (text: string) => {
    setMessage(({ count }) => ({ text, count: count + 1 }));
  };

  /** Asks for step-up before a form opens, so nothing typed is lost to it. */
  async function ready(): Promise<boolean> {
    const until = session.status === 'ready' ? (session.session.recentAuthUntil ?? null) : null;
    const recent = until !== null && Date.parse(until) > Date.now();
    let checked = false;
    const done = await stepUp.run(() => {
      if (checked || recent) return Promise.resolve(true);
      checked = true;
      return Promise.reject(new ProblemError(403, STEP_UP_NEEDED));
    });
    return done === true;
  }

  /** Runs a change that needs step-up, showing a problem on the page. Null when cancelled or refused. */
  async function act<T>(work: () => Promise<T>): Promise<T | null> {
    setProblem(null);
    try {
      return await stepUp.run(work);
    } catch (error) {
      setProblem(asProblem(error)?.detail ?? messages.serviceFailed);
      return null;
    }
  }

  const replace = (updated: Provider) => {
    setProviders((current) => current.map((p) => (p.id === updated.id ? updated : p)));
  };

  async function save(target: Open, body: ProviderBody) {
    const saved = await stepUp.run(() =>
      target.provider === null
        ? callApi(addSsoProvider, { body: body as AddBody })
        : callApi(changeSsoProvider, { params: { providerId: target.provider.id }, body }),
    );
    if (saved === null) return;
    setProviders((current) =>
      target.provider === null
        ? [...current, saved]
        : current.map((p) => (p.id === saved.id ? saved : p)),
    );
    closeForm();
    say(`${saved.name} is saved.`);
  }

  async function removeConfirmed({ provider, domain }: Asking) {
    if (domain === null) {
      const done = await act(async () => {
        await callApi(removeSsoProvider, { params: { providerId: provider.id } });
        return true;
      });
      if (done === null) return;
      setProviders((current) => current.filter((p) => p.id !== provider.id));
      say(`${provider.name} is removed.`);
      return;
    }
    const done = await act(async () => {
      await callApi(removeSsoDomain, {
        params: { providerId: provider.id, domainId: domain.id },
      });
      return true;
    });
    if (done === null) return;
    replace({ ...provider, domains: provider.domains.filter((d) => d.id !== domain.id) });
    say(`${domain.domain} is removed.`);
  }

  const actions: ProviderActions = {
    change: (provider) => {
      rememberOpener();
      void ready().then((ok) => {
        if (ok) setOpen({ kind: provider.kind, provider });
      });
    },
    remove: (provider) => {
      setAsking({ provider, domain: null });
    },
    openDomain: ready,
    addDomain: async (provider, domain) => {
      const added = await stepUp.run(() =>
        callApi(addSsoDomain, { params: { providerId: provider.id }, body: { domain } }),
      );
      if (added === null) return;
      const { dnsRecord, ...stored } = added;
      setRecords((current) => ({ ...current, [stored.id]: dnsRecord }));
      replace({ ...provider, domains: [...provider.domains, stored] });
      say(`${stored.domain} is added. Publish the DNS record, then verify the domain.`);
    },
    verify: async (provider, domain) => {
      const verified = await act(() =>
        callApi(verifySsoDomain, { params: { providerId: provider.id, domainId: domain.id } }),
      );
      if (verified === null) return;
      if (verified.status === 'pending') {
        setProblem(notFoundYet);
        return;
      }
      replace({
        ...provider,
        domains: provider.domains.map((d) => (d.id === verified.id ? verified : d)),
      });
      say(`${verified.domain} is verified.`);
    },
    removeDomain: (provider, domain) => {
      setAsking({ provider, domain });
    },
  };

  const choose = (kind: Open['kind']) => {
    rememberOpener();
    void ready().then((ok) => {
      if (ok) setOpen({ kind, provider: null });
    });
  };

  const subject = asking?.domain?.domain ?? asking?.provider.name ?? '';

  return (
    <>
      <p role="status" className="min-h-6 text-body font-medium text-success">
        {message.text}
      </p>
      {problem !== null && (
        <p role="alert" className="text-body font-medium text-danger">
          {problem}
        </p>
      )}
      <section aria-labelledby="providers" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="providers"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Providers
          </h2>
          <span className="flex gap-2">
            <Button
              onClick={() => {
                choose('oidc');
              }}
            >
              Add OIDC provider
            </Button>
            <Button
              onClick={() => {
                choose('saml');
              }}
            >
              Add SAML provider
            </Button>
          </span>
        </div>
        {open !== null && (
          <ProviderForm
            key={`${open.kind}-${open.provider?.id ?? 'new'}`}
            kind={open.kind}
            provider={open.provider}
            save={(body) => save(open, body)}
            onCancel={closeForm}
          />
        )}
        {providers.length === 0 && open === null ? (
          <EmptyState title="No single sign-on providers" headingLevel="h3">
            <p>
              Add an OIDC or SAML provider, then add and verify your email domains. Staff with a
              verified domain can then sign in through their organisation.
            </p>
          </EmptyState>
        ) : (
          providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              records={records}
              actions={actions}
            />
          ))
        )}
      </section>
      <Dialog
        open={asking !== null}
        onOpenChange={(next) => {
          if (!next) setAsking(null);
        }}
        title={asking?.domain ? `Remove domain ${subject}?` : `Remove provider ${subject}?`}
        description={
          asking?.domain
            ? `Staff with an email address at ${subject} will no longer match this provider. They will sign in with a password and code instead.`
            : `Staff who use ${subject} will sign in with a password and code instead. Its domains stop matching.`
        }
        actions={
          <>
            <Button
              variant="danger"
              onClick={() => {
                const target = asking;
                setAsking(null);
                if (target !== null) void removeConfirmed(target);
              }}
            >
              {asking?.domain ? 'Remove domain' : 'Remove provider'}
            </Button>
            <Button
              data-autofocus
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep {asking?.domain ? 'domain' : 'provider'}
            </Button>
          </>
        }
      />
      {stepUp.dialog}
    </>
  );
}

/** A funder's single sign-on providers and the email domains each serves. */
export default function SsoPage() {
  const { state, retry } = useLoad(loadProviders);
  return (
    <div className="flex max-w-3xl flex-col gap-stack">
      <PageHeader
        title="Single sign-on"
        description="Let staff sign in with your organisation's identity provider. Changes ask you to confirm it is you first."
      />
      <SettingsSections />
      <WhenLoaded state={state} label="Loading providers" retry={retry}>
        {(initial) => <Providers initial={initial} />}
      </WhenLoaded>
    </div>
  );
}
