// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the unsubscribe specs share: a made-up token of the right length and
// character set, and the keys the stub answers to.

export const TOKEN = 'dGVzdC10b2tlbi1mb3Itc3ludGhldGljLWRhdGEtb25seS0wMDAx'; // gitleaks:allow
export const PATH = `/northfield/unsubscribe?token=${TOKEN}`;
export const GET = 'GET /public/unsubscribe';
export const POST = 'POST /public/unsubscribe';

export const target = { status: 200, body: { purpose: 'future_funding', channel: 'email' } };
export const outcome = (name: 'unsubscribed' | 'already_unsubscribed') => ({
  status: 200,
  body: { outcome: name },
});
export const REFUSED = 'This link has expired or is not valid';
