// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The subject access export as the file S11-45 defines (ADR 0027), written a
// row at a time so no step holds the whole document as one string. Every row
// was checked against the shared schema before it gets here. The file is
// classed as the most sensitive field it holds, from the classification map
// and, for form answers, the pinned form version's class carried by the cell;
// a column the map does not list throws rather than defaulting low.

import { SENSITIVITIES, type Sensitivity } from '@pixel-scientists/db/classification';

import { mostSensitive } from '../../../../../packages/db/src/job-request.ts';
import type { ModuleData } from './registry.ts';
import type { SubjectAuditEvent } from './platform-data.ts';

export interface SubjectAccessData {
  readonly modules: ModuleData;
  readonly auditEvents: readonly SubjectAuditEvent[];
}

export interface ExportHeader {
  readonly tenantId: string;
  readonly subjectPartyId: string;
  readonly createdAt: string;
}

const json = JSON.stringify;

/** The file's JSON text in pieces, in the order the schema lists its keys. */
export function* exportChunks(
  header: ExportHeader,
  { modules, auditEvents }: SubjectAccessData,
): Generator<string> {
  yield `{"version":1,"tenantId":${json(header.tenantId)},"subjectPartyId":${json(header.subjectPartyId)},"createdAt":${json(header.createdAt)},"modules":{`;
  let firstModule = true;
  for (const [module, tables] of Object.entries(modules)) {
    yield `${firstModule ? '' : ','}${json(module)}:{`;
    firstModule = false;
    let firstTable = true;
    for (const [table, rows] of Object.entries(tables)) {
      yield `${firstTable ? '' : ','}${json(table)}:[`;
      firstTable = false;
      for (const [index, row] of rows.entries()) yield `${index === 0 ? '' : ','}${json(row)}`;
      yield ']';
    }
    yield '}';
  }
  yield '},"auditEvents":[';
  for (const [index, event] of auditEvents.entries())
    yield `${index === 0 ? '' : ','}${json(event)}`;
  yield ']}';
}

/** Every field id the file holds, and each form answer's class (the highest, where versions differ). */
export function writtenFields(data: SubjectAccessData): {
  fieldIds: string[];
  answerClasses: Record<string, Sensitivity>;
} {
  const fieldIds = new Set<string>();
  const answerClasses: Record<string, Sensitivity> = {};
  const rank = (sensitivity: Sensitivity) => SENSITIVITIES.indexOf(sensitivity);
  for (const tables of Object.values(data.modules)) {
    for (const rows of Object.values(tables)) {
      for (const row of rows) {
        for (const [id, { sensitivity }] of Object.entries(row)) {
          fieldIds.add(id);
          const held = answerClasses[id];
          if (id.startsWith('f_') && (held === undefined || rank(sensitivity) > rank(held))) {
            answerClasses[id] = sensitivity;
          }
        }
      }
    }
  }
  if (data.auditEvents.length > 0) fieldIds.add('app.audit_event.changes');
  return { fieldIds: [...fieldIds], answerClasses };
}

/** What the output file is classed as. */
export function outputSensitivity(data: SubjectAccessData): Sensitivity {
  const { fieldIds, answerClasses } = writtenFields(data);
  return mostSensitive(fieldIds, answerClasses);
}
