// SPDX-License-Identifier: AGPL-3.0-or-later

export { collectSubjectAccess, type MergeSet } from './collect.ts';
export { exportChunks, outputSensitivity, writtenFields } from './export-file.ts';
export type { ExportHeader, SubjectAccessData } from './export-file.ts';
export { platformData, subjectAuditEvents } from './platform-data.ts';
export type { SubjectAuditEvent } from './platform-data.ts';
export { collectModuleData } from './registry.ts';
export type { Contribution, ModuleData } from './registry.ts';
