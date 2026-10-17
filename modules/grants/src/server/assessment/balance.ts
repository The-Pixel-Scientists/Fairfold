// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Automatic assignment's choice (ADR 0004): for each submission in the
// order given, the reviewers who are not excluded from it with the fewest
// open assignments, ties broken by membership id, so the same request
// against the same state picks the same people. Each pick counts as an open
// assignment for the next submission.

export interface BalanceSubmission {
  readonly id: string;
  /** Reviewers it has at the stage already, not counting a conflicted one. */
  readonly filled: number;
  /** Reviewers who may not take it: already assigned at the stage, or conflicted on it. */
  readonly excluded: ReadonlySet<string>;
}

export interface Balanced {
  readonly picks: readonly { readonly submissionId: string; readonly membershipId: string }[];
  readonly unfilled: { readonly submissionId: string; readonly missing: number }[];
}

export function balance(
  submissions: readonly BalanceSubmission[],
  pool: readonly string[],
  openAssignments: ReadonlyMap<string, number>,
  wanted: number,
): Balanced {
  const load = new Map(pool.map((id) => [id, openAssignments.get(id) ?? 0]));
  const picks: { submissionId: string; membershipId: string }[] = [];
  const unfilled: { submissionId: string; missing: number }[] = [];
  for (const submission of submissions) {
    const needed = Math.max(0, wanted - submission.filled);
    const chosen = pool
      .filter((id) => !submission.excluded.has(id))
      .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, needed);
    for (const membershipId of chosen) {
      load.set(membershipId, (load.get(membershipId) ?? 0) + 1);
      picks.push({ submissionId: submission.id, membershipId });
    }
    if (chosen.length < needed) {
      unfilled.push({ submissionId: submission.id, missing: needed - chosen.length });
    }
  }
  return { picks, unfilled };
}
