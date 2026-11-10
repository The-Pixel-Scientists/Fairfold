// SPDX-License-Identifier: AGPL-3.0-or-later
// Examples for jobs.yaml, checked by `semgrep --test infra/semgrep`. The
// calls before the bossOf import below stand for files that import neither it
// nor pg-boss.

// ok: tps-jobs-sent-only-by-jobs-helpers
await reply.code(200).send(body);
// ok: tps-jobs-sent-only-by-jobs-helpers
await transporter.send(envelope, raw);
// ok: tps-jobs-sent-only-by-jobs-helpers
await jobs.publish(trx, applicationSubmitted, data, context);
// ok: tps-jobs-sent-only-by-jobs-helpers
await sendJob(trx, digestQueue, { digestId }, context);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.sendAfter('emails.send', data, null, 60);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await queue.sendThrottled('emails.send', data, null, 60, key);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await queue.sendDebounced('emails.send', data, null, 60);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await trx.executeQuery(sql`INSERT INTO pgboss.job (name, data) VALUES (${name}, ${data})`);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await client.query('insert into "pgboss"."job" (name, data) values ($1, $2)', [name, data]);
// ok: tps-jobs-sent-only-by-jobs-helpers
await client.query('SELECT state FROM pgboss.job WHERE id = $1', [id]);
// ok: tps-job-schedules-only-in-worker
await calendar.schedule(meeting);

import { bossOf } from './worker.ts';
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await bossOf(runner).publish('application.submitted', data);

import { PgBoss } from 'pg-boss';

const boss = new PgBoss({ db });
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.send('emails.send', data);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.insert('emails.send', [{ data }]);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.publish('application.submitted', data);
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.flow([{ name: 'emails.send', data }]);
// ruleid: tps-job-schedules-only-in-worker
await boss.schedule('digest', '0 7 * * *', data);
// ok: tps-job-schedules-only-in-worker
await boss.unschedule('digest');
// ruleid: tps-jobs-sent-only-by-jobs-helpers
await boss.redrive('emails.send.dead');
// ok: tps-jobs-sent-only-by-jobs-helpers
await boss.getQueue('emails.send');
