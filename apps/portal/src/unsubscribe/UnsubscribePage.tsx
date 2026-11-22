// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The page an unsubscribe link opens, with no sign-in. Opening it only reads
// what the link would stop; nothing changes until the person presses the
// button. The token stays in the address and goes nowhere else. Every link
// that does not work gets the same words, so a token cannot be probed.

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  confirmUnsubscribe,
  getUnsubscribe,
  unsubscribeTokenSchema,
} from '@pixel-scientists/party/contracts';
import type { ConsentChannel, ConsentPurpose } from '@pixel-scientists/party/contracts';
import {
  Button,
  LoadingState,
  PageHeading,
  buttonClassName,
  useSearch,
} from '@pixel-scientists/ui';
import type { SearchSchema } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { callApi } from '../api.ts';
import { PageColumn } from '../PageColumn.tsx';
import { useRead } from '../party/useRead.ts';
import { whatStops } from './wording.ts';

const NO_CREDENTIALS = { anonymous: true } as const;
const REFUSED = 'This link has expired or is not valid';
const FAILED = 'We could not load this page. Check that you are online, then try again.';

const tokenSearch: SearchSchema<string> = {
  safeParse(input) {
    const result = unsubscribeTokenSchema.safeParse((input as Record<string, unknown>)['token']);
    return result.success ? { success: true, data: result.data } : { success: false, error: null };
  },
};

type Step =
  | { name: 'confirm' }
  | { name: 'failed'; message: string }
  | { name: 'done' }
  | { name: 'refused' };

interface Target {
  purpose: ConsentPurpose;
  channel: ConsentChannel;
}

function Frame({ heading, children }: { heading: string; children: ReactNode }) {
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // The router focuses the heading on arrival; a new result moves focus to it.
    if (first.current) first.current = false;
    else title.current?.focus();
  }, [heading]);
  return (
    <PageColumn>
      <div className="flex max-w-prose flex-col gap-4 text-lg text-ink">
        <PageHeading ref={title} className="text-3xl sm:text-4xl">
          {heading}
        </PageHeading>
        {children}
      </div>
    </PageColumn>
  );
}

function ChangeLink({ href }: { href: string }) {
  return (
    <div>
      <a href={href} rel="noreferrer" className={buttonClassName('secondary', 'w-full sm:w-auto')}>
        Change how we contact you
      </a>
    </div>
  );
}

function Refused({ href }: { href: string }) {
  return (
    <Frame heading={REFUSED}>
      <p>Use the link in a newer email, or sign in to change how we contact you.</p>
      <ChangeLink href={href} />
    </Frame>
  );
}

function Confirm({ token, target, href }: { token: string; target: Target; href: string }) {
  const [step, setStep] = useState<Step>({ name: 'confirm' });
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const stops = whatStops(target.purpose, target.channel);

  async function unsubscribe() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await callApi(
        confirmUnsubscribe,
        { query: { token }, body: { 'List-Unsubscribe': 'One-Click' } },
        NO_CREDENTIALS,
      );
      setStep({ name: 'done' });
    } catch (error) {
      const status = error instanceof ProblemError ? error.status : 0;
      setStep(
        status === 404
          ? { name: 'refused' }
          : { name: 'failed', message: status === 429 ? (error as Error).message : FAILED },
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  if (step.name === 'refused') return <Refused href={href} />;
  if (step.name === 'done') {
    return (
      <Frame heading="You have unsubscribed">
        <p>You will not get {stops} from this funder.</p>
        <ChangeLink href={href} />
      </Frame>
    );
  }
  return (
    <Frame heading={`Stop ${stops}`}>
      {step.name === 'failed' && <p role="alert">{step.message}</p>}
      <p>
        If you unsubscribe, you will not get {stops} from this funder. Nothing changes until you
        press the button.
      </p>
      <div>
        <Button
          type="button"
          variant="primary"
          aria-disabled={pending || undefined}
          className="w-full sm:w-auto"
          onClick={() => void unsubscribe()}
        >
          {pending ? 'Unsubscribing…' : 'Unsubscribe from these emails'}
        </Button>
      </div>
      <ChangeLink href={href} />
    </Frame>
  );
}

function FromLink({ token, href }: { token: string; href: string }) {
  const readTarget = useCallback(
    () => callApi(getUnsubscribe, { query: { token } }, NO_CREDENTIALS),
    [token],
  );
  const { read, retry } = useRead(readTarget);
  if (read.status === 'ready') return <Confirm token={token} target={read.data} href={href} />;
  if (read.status === 'failed' && read.missing) return <Refused href={href} />;
  return (
    <Frame heading="Unsubscribe">
      {read.status === 'loading' && <LoadingState label="Loading" />}
      {read.status === 'failed' && (
        <>
          <p>{read.limited ?? FAILED}</p>
          <div>
            <Button variant="primary" className="w-full sm:w-auto" onClick={retry}>
              Try again
            </Button>
          </div>
        </>
      )}
    </Frame>
  );
}

/** `preferencesHref` is the funder's "How we contact you" page, which asks the person to sign in. */
export function UnsubscribePage({ preferencesHref }: { preferencesHref: string }) {
  const search = useSearch(tokenSearch);
  return search.success ? (
    <FromLink token={search.data} href={preferencesHref} />
  ) : (
    <Refused href={preferencesHref} />
  );
}
