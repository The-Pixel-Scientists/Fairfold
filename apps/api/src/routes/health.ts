// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Liveness and readiness, for the platform's probes. Both are public and
// carry no tenant data. Liveness says the process is running. Readiness says
// it can reach its database; a probe takes the instance out of rotation while
// it cannot.

import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export type ReadinessResult = { ok: true } | { ok: false; error: unknown };

/** Checks what the API depends on. Never throws. */
export type ReadinessCheck = () => Promise<ReadinessResult>;

const livenessSchema = z.object({
  status: z.literal('ok'),
});

const readinessSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'unavailable']),
  }),
});

/**
 * Wrap a database check so a probe never waits longer than `timeoutMs`, and a
 * slow database is asked once at a time: while one check is still running,
 * every probe shares it rather than opening another connection.
 */
export function createReadinessCheck(
  checkDatabase: () => Promise<void>,
  timeoutMs: number,
): ReadinessCheck {
  let running: Promise<void> | undefined;
  return async () => {
    running ??= (async () => {
      await checkDatabase();
    })().finally(() => {
      running = undefined;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('The database did not answer in time.'));
      }, timeoutMs);
    });
    try {
      await Promise.race([running, timeout]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const healthRoutes: FastifyPluginCallbackZod<{ checkReadiness: ReadinessCheck }> = (
  app,
  options,
  done,
) => {
  let ready = true;

  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Check that the API is running',
        description: 'Answers while the process is running. It does not check the database.',
        response: { 200: livenessSchema },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Check that the API can serve requests',
        description:
          'Answers 200 when the API can reach its database, and 503 when it cannot. ' +
          'The response never says why.',
        response: { 200: readinessSchema, 503: readinessSchema },
      },
    },
    async (request, reply) => {
      const result = await options.checkReadiness();
      // Probes come every few seconds, so log a change of state, not each probe.
      if (result.ok !== ready) {
        ready = result.ok;
        if (result.ok) request.log.info('The database is ready again');
        else request.log.warn({ err: result.error }, 'The database is not ready');
      }
      if (result.ok) {
        return { status: 'ok' as const, checks: { database: 'ok' as const } };
      }
      return reply.code(503).send({
        status: 'unavailable',
        checks: { database: 'unavailable' },
      });
    },
  );

  done();
};
