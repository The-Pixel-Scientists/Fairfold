// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicate flags (ADR 0025, ADR 0031, rule 9). A flag asks staff to look at
// two parties that may be one. It is worked out when asked for, from party's
// own candidates, with party's thresholds: nothing is stored, and nothing
// here changes, holds, scores or links a party or an application. A flag
// holds two party ids and a signal, never a name, identifier, email or
// phone. Nothing here reads payment details (wave 2).
//
// A flag's id is derived from its two parties, in a fixed order, and its
// signal, so the same flag has the same id whichever party it is listed
// for. Listing a flag records its id, parties and signal (so it can be
// dismissed later) and nothing else; dismissing one needs a named member and
// a reason from the list, and a dismissed flag is listed with its dismissal.

import { idSchema } from '@pixel-scientists/domain';
import type {
  DuplicateSignal as PartySignal,
  PartyMerges,
} from '@pixel-scientists/party/contracts';
import type { PartyRequest } from '@pixel-scientists/party/server';

import {
  duplicateSignals,
  flagDismissalInputSchema,
  type DuplicateFlag,
} from '../../contracts/index.ts';
import type { Applicant, ChecklistContext, Tx } from '../checklists/context.ts';
import { dismiss, lockFlag, recordFlags, type FlagKey, type StoredFlag } from './store.ts';

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

/** What the handlers read from the request context: party's request, as party's contract takes it, and the audit of assure's own events. */
export interface DuplicateContext {
  readonly audit: PartyRequest['audit'] & Pick<ChecklistContext['audit'], 'record'>;
  readonly membership: { readonly id: string };
}

export interface DuplicateDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
  /** Party's contract: candidates, and whether the tenant has the party. */
  readonly parties: Pick<PartyMerges<PartyRequest>, 'duplicateCandidates' | 'resolveParty'>;
  /** The application's organisation and applicant, through grants' server; null when missing, a draft or grants is off. */
  readonly readApplicant: (tx: Tx, applicationId: string) => Promise<Applicant | null>;
  /** SHA-256 of a text, in lower-case hex, which this module may not compute itself. */
  readonly digest: (text: string) => string;
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

  /** The flag as stored, which holds its two parties in a fixed order. */
  const keyOf = (partyId: string, otherPartyId: string, signal: FlagKey['signal']): FlagKey => {
    const [low, high] = partyId < otherPartyId ? [partyId, otherPartyId] : [otherPartyId, partyId];
    return { id: flagId(deps.digest, low, high, signal), partyId: low, otherPartyId: high, signal };
  };

  const shown = (
    stored: StoredFlag,
    partyId: string,
    otherPartyId: string,
    applicationId: string | null,
  ): DuplicateFlag => ({
    id: stored.id,
    partyId,
    otherPartyId,
    applicationId,
    otherApplicationId: null,
    signal: stored.signal,
    raisedAt: stored.raisedAt,
    dismissal: stored.dismissal,
  });

  /** The flags raised for one party, from party's candidates, recorded as listed. */
  async function flagsFor(
    request: PartyRequest,
    partyId: string,
    applicationId: string | null,
  ): Promise<DuplicateFlag[]> {
    const candidates = await deps.parties.duplicateCandidates(request, partyId);
    const raised = candidates.flatMap(({ partyId: otherPartyId, signals }) =>
      [...new Set(signals.map((signal) => RAISES[signal]))].flatMap((signal) =>
        signal === null ? [] : [{ otherPartyId, key: keyOf(partyId, otherPartyId, signal) }],
      ),
    );
    const stored = await recordFlags(
      request.tx,
      request.membership.id,
      raised.map(({ key }) => key),
    );
    return raised.flatMap(({ otherPartyId, key }) => {
      const flag = stored.get(key.id);
      return flag === undefined ? [] : [shown(flag, partyId, otherPartyId, applicationId)];
    });
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

  /** Dismisses a flag once, with a reason from the list, as the member in the session. */
  async function dismissDuplicateFlag({
    tx,
    context,
    input,
  }: Args<{ params: { flagId: string }; body: unknown }>) {
    const id = idOrNotFound(input.params.flagId);
    const body = flagDismissalInputSchema.safeParse(input.body);
    if (!body.success) throw deps.refuse(400, 'Choose a reason from the list.');
    const flag = await lockFlag(tx, id);
    if (flag === undefined) throw deps.notFound();
    if (flag.dismissal !== null) throw deps.refuse(409, 'This flag has already been dismissed.');
    const dismissed = await dismiss(tx, id, body.data.reason, context.membership.id);
    await context.audit.record({
      action: 'assure.duplicate_flag.dismissed',
      entityId: id,
      subjectPartyId: dismissed.partyId,
      changes: { 'assure.duplicate_flag.dismiss_reason': { after: body.data.reason } },
    });
    return shown(dismissed, dismissed.partyId, dismissed.otherPartyId, null);
  }

  return { listApplicationDuplicateFlags, listPartyDuplicateFlags, dismissDuplicateFlag };
}
