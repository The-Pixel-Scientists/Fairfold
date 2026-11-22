// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  Button,
  Notice,
  Panel,
  SummaryList,
  Tag,
  WhenLoaded,
  asProblem,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type {
  LookupOfficer,
  LookupSnapshot,
  OrganisationLookups,
  Registry,
} from '../contracts/index.ts';
import { loadLookups, loadOfficers, refreshLookup } from './loaders.ts';
import {
  formatDay,
  formatMoment,
  isStale,
  officerRoleWords,
  registryWords,
  statusWords,
} from './words.ts';

/** How often a refresh is checked, and how many times, before the panel stops waiting. */
export const POLL_INTERVAL_MS = 3000;
export const POLL_LIMIT = 10;

const NOT_FOUND_WORDS =
  'The register has no entry for this number. Check the number on the organisation record, then refresh.';
const NOT_SET_UP_WORDS =
  'This register is not set up for your funder. Ask an administrator to add its key.';
const STILL_WAITING = 'The refresh is taking longer than expected. Check again in a few minutes.';
const UNEXPECTED = 'Something went wrong. Try again.';

interface Waiting {
  registry: Registry;
  /** The fetched time when the refresh was asked for, which changes when it is done. */
  since: string | null;
  polls: number;
}

function Officers({ snapshot }: { snapshot: LookupSnapshot }) {
  const [officers, setOfficers] = useState<readonly LookupOfficer[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const label = registryWords[snapshot.registry];
  const total = snapshot.details?.officerCount ?? 0;
  const count = total === 1 ? '1 officer or trustee' : `${String(total)} officers and trustees`;

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        aria-expanded={officers !== null}
        aria-label={`Show ${count} from ${label}`}
        aria-disabled={officers !== null || undefined}
        onClick={() => {
          if (officers !== null) return;
          setFailed(null);
          loadOfficers(snapshot.id).then(
            (list) => {
              setOfficers(list.officers);
            },
            (error: unknown) => {
              setFailed(asProblem(error)?.detail ?? UNEXPECTED);
            },
          );
        }}
      >
        {`Show ${count}`}
      </Button>
      <div role="status" className="w-full">
        {officers !== null &&
          (officers.length === 0 ? (
            <p className="text-muted">The register lists no officers or trustees.</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label={`Officers and trustees from ${label}`}>
              {officers.map((officer) => (
                <li key={officer.id}>
                  {officer.name}{' '}
                  <span className="text-muted">({officerRoleWords[officer.role]})</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
      {failed !== null && (
        <p role="alert" className="text-danger">
          {failed}
        </p>
      )}
    </div>
  );
}

function Details({ snapshot }: { snapshot: LookupSnapshot }) {
  const { details } = snapshot;
  if (details === null) return <p>{NOT_FOUND_WORDS}</p>;
  const { registeredAddress: address, accounts } = details;
  return (
    <SummaryList
      items={[
        { term: 'Registered name', value: details.registeredName },
        { term: 'Number', value: snapshot.identifier },
        { term: 'Status', value: statusWords[details.status] },
        {
          term: 'Registered on',
          value: details.registeredOn === null ? 'Not given' : formatDay(details.registeredOn),
        },
        ...(details.removedOn === null
          ? []
          : [{ term: 'Removed on', value: formatDay(details.removedOn) }]),
        {
          term: 'Registered address',
          value:
            address === null
              ? 'Not given'
              : [address.line1, address.line2, address.town, address.postcode, address.countryCode]
                  .filter((line) => line !== null)
                  .map((line, index) => (
                    <span key={index} className="block">
                      {line}
                    </span>
                  )),
        },
        {
          term: 'Latest accounts',
          value:
            accounts === null
              ? 'None filed'
              : [
                  `Year ending ${formatDay(accounts.periodEnd)}`,
                  accounts.income && `income ${formatMoney(accounts.income)}`,
                  accounts.expenditure && `spending ${formatMoney(accounts.expenditure)}`,
                ]
                  .filter(Boolean)
                  .join(', '),
        },
        ...(details.accountsOverdue === null
          ? []
          : [{ term: 'Accounts overdue', value: details.accountsOverdue ? 'Yes' : 'No' }]),
      ]}
    />
  );
}

function Source({
  snapshot,
  waiting,
  canRefresh,
  onRefresh,
}: {
  snapshot: LookupSnapshot;
  waiting: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const label = registryWords[snapshot.registry];
  const stale = isStale(snapshot.fetchedAt);
  return (
    <section aria-labelledby={`registry-${snapshot.registry}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={`registry-${snapshot.registry}`} className="text-body font-semibold">
          {label}
        </h3>
        {stale && <Tag tone="warning">Out of date</Tag>}
      </div>
      <p className="text-muted">
        {`From the ${label} register. Fetched ${formatMoment(snapshot.fetchedAt)}.`}
        {stale && ' This is more than 30 days old.'}
      </p>
      <Details snapshot={snapshot} />
      {snapshot.details !== null && snapshot.details.officerCount > 0 && (
        <Officers snapshot={snapshot} />
      )}
      {canRefresh && (
        <div>
          <Button
            aria-label={`Refresh registry details from ${label}`}
            aria-disabled={waiting || undefined}
            onClick={onRefresh}
          >
            Refresh registry details
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * What each register says about one organisation, where it came from and
 * when it was fetched. It reads and refreshes only: it never links, verifies
 * or changes an identifier or a party. Mount it with an organisation's id.
 */
export function RegistryPanel({ organisationId }: { organisationId: string }) {
  const { state, retry } = useLoad(loadLookups, organisationId);
  const canRefresh = useCan('assure.lookup.run');
  const [latest, setLatest] = useState<OrganisationLookups | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [said, setSaid] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const retryKey = useRef<{ registry: Registry; key: string } | null>(null);

  useEffect(() => {
    if (waiting === null) return;
    let current = true;
    const timer = setTimeout(() => {
      loadLookups(organisationId).then(
        (next) => {
          if (!current) return;
          setLatest(next);
          const fetched = next.snapshots.find(({ registry }) => registry === waiting.registry);
          if (fetched !== undefined && fetched.fetchedAt !== waiting.since) {
            setWaiting(null);
            setSaid(`${registryWords[waiting.registry]} details are up to date.`);
          } else if (waiting.polls + 1 >= POLL_LIMIT) {
            setWaiting(null);
            setSaid(STILL_WAITING);
          } else {
            setWaiting({ ...waiting, polls: waiting.polls + 1 });
          }
        },
        (error: unknown) => {
          if (!current) return;
          setWaiting(null);
          setProblem(asProblem(error)?.detail ?? UNEXPECTED);
        },
      );
    }, POLL_INTERVAL_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [waiting, organisationId]);

  async function refresh(snapshot: LookupSnapshot) {
    if (busy.current || waiting !== null) return;
    busy.current = true;
    setProblem(null);
    const key = retryKey.current?.registry === snapshot.registry ? retryKey.current.key : undefined;
    try {
      await refreshLookup(organisationId, snapshot.registry, key);
      retryKey.current = null;
      setSaid(`Refresh started for ${registryWords[snapshot.registry]}. This can take a minute.`);
      setWaiting({ registry: snapshot.registry, since: snapshot.fetchedAt, polls: 0 });
    } catch (error) {
      const failure = asProblem(error);
      const sent = (error as { idempotencyKey?: string | null }).idempotencyKey;
      retryKey.current =
        typeof sent === 'string' ? { registry: snapshot.registry, key: sent } : null;
      setProblem(failure?.detail ?? UNEXPECTED);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Panel title="Registry details">
      <WhenLoaded state={state} label="Loading registry details" retry={retry}>
        {(first) => {
          const { snapshots, notSetUp } = latest ?? first;
          return (
            <>
              <p role="status" aria-live="polite" className="text-muted empty:hidden">
                {said}
              </p>
              {problem !== null && (
                <div role="alert">
                  <Notice tone="danger" title="The registry details were not refreshed">
                    {problem}
                  </Notice>
                </div>
              )}
              {snapshots.length === 0 && notSetUp.length === 0 && (
                <p>
                  No registry details have been fetched. Add a charity or company number to the
                  organisation record, and the details appear here.
                </p>
              )}
              {snapshots.map((snapshot) => (
                <Source
                  key={snapshot.id}
                  snapshot={snapshot}
                  waiting={waiting !== null}
                  canRefresh={canRefresh}
                  onRefresh={() => void refresh(snapshot)}
                />
              ))}
              {notSetUp.map((registry) => (
                <section key={registry} aria-labelledby={`registry-${registry}`}>
                  <h3 id={`registry-${registry}`} className="text-body font-semibold">
                    {registryWords[registry]}
                  </h3>
                  <p className="text-muted">{NOT_SET_UP_WORDS}</p>
                </section>
              ))}
            </>
          );
        }}
      </WhenLoaded>
    </Panel>
  );
}
