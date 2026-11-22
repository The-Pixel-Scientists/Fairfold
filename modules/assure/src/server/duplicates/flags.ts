// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags (ADR 0025, ADR 0031, rule 9). A flag asks staff to look at
// two parties that may be one. It is worked out when asked for, from party's
// own candidates, with party's thresholds: nothing is stored, and nothing
// here changes, holds, scores or links a party or an application. A flag
// holds two party ids and a signal, never a name, identifier, email or
// phone. Nothing here reads payment details (wave 2).
//
// A flag's id is derived from its parties and signal, so the same flag has
// the same id on every read. A flag cannot be dismissed until the schema
// can hold one.

import { idSchema } from '@pixel-scientists/domain';
import type {
  DuplicateSignal as PartySignal,
  PartyMerges,
} from '@pixel-scientists/party/contracts';
import type { PartyRequest } from '@pixel-scientists/party/server';

import { duplicateSignals, type DuplicateFlag } from '../../contracts/index.ts';
import type { Applicant, Tx } from '../checklists/context.ts';

type FlagSignal = (typeof duplicateSignals)[number];

/**
 * What each of party's signals raises. A claimed identifier is only typed,
 * and typing an identifier never links anyone (ADR 0025), so it raises none.
 */
const RAISES: Record<PartySignal, FlagSignal | null> = {
  verified_identifier: 'shared_identifier',
  claimed_identifier: null,
  name: 'similar_name',
  name_and_postcode: 'similar_name',
  name_and_organisation: 'similar_name',
  email: 'shared_contact_point',
};

/** What the handlers read from the request context: party's request, as party's contract takes it. */
export interface DuplicateContext {
  readonly audit: PartyRequest['audit'];
  readonly membership: { readonly id: string };
}

export interface DuplicateDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** Party's contract: candidates, and whether the tenant has the party. */
  readonly parties: Pick<PartyMerges<PartyRequest>, 'duplicateCandidates' | 'resolveParty'>;
  /** The application's organisation and applicant, through grants' server; null when missing, a draft or grants is off. */
  readonly readApplicant: (tx: Tx, applicationId: string) => Promise<Applicant | null>;
  /** SHA-256 of a text, in lower-case hex, which this module may not compute itself. */
  readonly digest: (text: string) => string;
  /** The clock tests move. */
  readonly now?: () => Date;
}

interface Args<I> {
  readonly tx: Tx;
  readonly context: DuplicateContext;
  readonly input: I;
}

/** A UUID derived from the parts, so a flag keeps its id. */
export function flagId(digest: (text: string) => string, ...parts: readonly string[]): string {
  const hex = digest(parts.join('|'));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const strongest = (flag: DuplicateFlag) => duplicateSignals.indexOf(flag.signal);

export function duplicateHandlers(deps: DuplicateDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };
  const requestOf = (tx: Tx, { audit, membership }: DuplicateContext): PartyRequest => ({
    tx,
    audit,
    membership,
  });

  /** The flags raised for one party, from party's candidates. */
  async function flagsFor(
    request: PartyRequest,
    partyId: string,
    applicationId: string | null,
  ): Promise<DuplicateFlag[]> {
    const raisedAt = (deps.now ?? (() => new Date()))().toISOString();
    const candidates = await deps.parties.duplicateCandidates(request, partyId);
    return candidates.flatMap(({ partyId: otherPartyId, signals }) =>
      [...new Set(signals.map((signal) => RAISES[signal]))].flatMap((signal) =>
        signal === null
          ? []
          : [
              {
                id: flagId(deps.digest, partyId, otherPartyId, signal),
                partyId,
                otherPartyId,
                applicationId,
                otherApplicationId: null,
                signal,
                raisedAt,
                dismissal: null,
              },
            ],
      ),
    );
  }

  const ordered = (flags: DuplicateFlag[]) =>
    flags.sort(
      (a, b) => strongest(a) - strongest(b) || a.otherPartyId.localeCompare(b.otherPartyId),
    );

  /** Flags for the application's organisation, and for the person who applied. */
  async function listApplicationDuplicateFlags({
    tx,
    context,
    input,
  }: Args<{ params: { applicationId: string } }>) {
    const applicationId = idOrNotFound(input.params.applicationId);
    const applicant = await deps.readApplicant(tx, applicationId);
    if (applicant === null) throw deps.notFound();
    const request = requestOf(tx, context);
    const flags = [
      ...(await flagsFor(request, applicant.organisationId, applicationId)),
      ...(await flagsFor(request, applicant.applicantPersonId, applicationId)),
    ];
    return { flags: ordered(flags) };
  }

  async function listPartyDuplicateFlags({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string } }>) {
    const partyId = idOrNotFound(input.params.partyId);
    const request = requestOf(tx, context);
    if ((await deps.parties.resolveParty(request, partyId)) === null) throw deps.notFound();
    return { flags: ordered(await flagsFor(request, partyId, null)) };
  }

  return { listApplicationDuplicateFlags, listPartyDuplicateFlags };
}
