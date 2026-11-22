# Handle a dead-lettered job

Use this page when a background job has run out of retries. It shows how to
find what failed and why, and how to decide whether a re-send is safe.

## When to use this

The `DeadLetteredJob` alert fires. It names this page and fires when any
queue holds a dead-lettered job (`tps_queue_dead_letters` above 0). The Jobs
dashboard shows "Dead-lettered jobs, by queue". Several failures in a short
time also raise `JobFailuresHigh`, which names
[Respond to a security incident](incident.md).

## Before you start

- You are a platform operator. Self-hosters: whoever runs the install.
- A job has a queue name and a job id. Neither holds personal data. The error
  is stored as a code only.
- Jobs are kept for 7 days after they complete, fail or dead-letter. After
  that they are gone, so act within the week.
- Never use pg-boss's own redrive or retry tools. They create a job with no
  tenant, and the database refuses it. A re-send must run from inside the
  original tenant's context. Do not run SQL on the `pgboss` schema.

## Steps

1. **Find the queue.** The alert's `tps_queue` label and the Jobs dashboard
   name it. Note how many jobs are dead-lettered.
2. **Find the error code.** Read the worker logs for that queue. Managed
   service: Cloud Run logs for the worker. Self-hosted: `pnpm stack logs
   worker`. Each failure logs the queue, the job id and a code such as a
   timeout or a refused connection. Write down the codes, never payload
   values.
3. **Fix the cause first.** A re-send into the same fault fails again. Check
   the mail server for email jobs, the database connection for any job, and
   whether a release deployed just before the first failure.
4. **Decide whether a re-send is safe.** Handlers check their preconditions
   and delivery is at least once, so most jobs are safe to run twice. Check
   before re-sending a job that:
   - sends an email, because the person may get it twice if the first send
     partly worked;
   - concerns a decision, because decisions are private until a named staff
     member releases them, and a job must never release one by itself.
   Ask the funder's administrator to confirm that the email or decision is
   still wanted.
5. **Re-send the job.** No operator command is available yet. The function
   that re-sends one dead-lettered job from its tenant's context exists in the
   worker's code, but no command runs it, so you cannot use it from here. Do
   not call it by hand and do not use pg-boss's redrive. Record the queue, the
   job id, the error code and your decision, and pass them to the engineering
   lead, who will say when the command can be used. This page will then give
   its exact name.

## Check it worked

- The Jobs dashboard's dead-lettered count for the queue falls.
- Once a re-send command exists: the worker logs a new job for the same
  queue, which completes, and the funder's audit log holds an event for the
  re-send with the operator as the actor.
- The `DeadLetteredJob` alert clears.

## If something goes wrong

- The job fails again: the cause is not fixed. Stop and read the new error
  code. Do not loop.
- The 7 days have passed: the job is gone. Ask the funder to repeat the
  action, for example by sending the email again from the console.
- Many queues fail at once: start [Respond to a security incident](incident.md).
- A job of another funder turns up in your search: it is not an error. Handle
  it the same way, and never search by personal data.

## Record

Write: the date, the queue, the job id, the error code, the cause, whether it
was safe to re-send and why, and what happened next. Never write payload
values, addresses or names.

A re-send writes an audit event in the original tenant. Your decision to
re-send or not is recorded only in your notes.
