// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The API's logger: JSON lines on standard output, one per event, for the
// platform's log collector to read. Fastify adds the request id (`requestId`)
// to every line written through `request.log`. What may appear in a line is
// decided in redaction.ts, and how a request appears in request-serializer.ts.

import type { ClassificationRegistry } from '@pixel-scientists/db/classification';
import {
  pino,
  stdTimeFunctions,
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
} from 'pino';

import type { LogLevel } from './config.ts';
import { redactLogObject, sensitiveKeyMatcher } from './redaction.ts';
import { serializeRequest } from './request-serializer.ts';
import { isError, serializeError } from './serialize-error.ts';

export interface LoggerOptions {
  level: LogLevel;
  /** Where lines go. Standard output when left out; tests pass their own. */
  destination?: DestinationStream;
  /** The field classification map. The shipped map when left out. */
  registry?: ClassificationRegistry;
}

/** The methods that add fields to a logger once, outside any log call. */
interface BindingMethods {
  child: (this: Logger, bindings: Bindings, options?: ChildLoggerOptions) => Logger;
  setBindings: (this: Logger, bindings: Bindings) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const isSensitive = sensitiveKeyMatcher(options.registry);
  const serializers = {
    req: serializeRequest,
    res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
    err: (error: unknown) => serializeError(error),
  };
  const serialised = Object.keys(serializers);

  const logger = pino(
    {
      level: options.level,
      base: { service: 'tps-api' },
      timestamp: stdTimeFunctions.isoTime,
      messageKey: 'msg',
      serializers,
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => redactLogObject(object, isSensitive, serialised),
      },
      hooks: {
        // With no message of its own, pino logs the message of the error it is
        // given, and that message can hold input.
        logMethod(args, method) {
          const call = args as unknown[];
          const first = call[0];
          const err = isError(first) ? first : (first as { err?: unknown } | null)?.err;
          if (call[1] === undefined && err !== undefined) call[1] = serializeError(err).message;
          method.apply(this, args);
        },
      },
    },
    options.destination,
  );

  // The fields of a child logger are written once, when it is made, and pino
  // skips its `bindings` formatter for a child made without options. Censor
  // them here instead, for `child()` and `setBindings()`. Every child, and
  // Fastify's logger for each request, inherits these methods. A child cannot
  // bring its own formatters, which would replace the redaction of its lines.
  const patchable = logger as unknown as BindingMethods;
  const { child, setBindings } = patchable;
  const censor = (bindings: Bindings) => redactLogObject(bindings, isSensitive, serialised);
  patchable.child = function (this: Logger, bindings, childOptions) {
    if (childOptions && 'formatters' in childOptions) {
      throw new Error('A child logger cannot change how its fields are redacted.');
    }
    return child.call(this, censor(bindings), childOptions);
  };
  patchable.setBindings = function (this: Logger, bindings) {
    setBindings.call(this, censor(bindings));
  };
  return logger;
}
