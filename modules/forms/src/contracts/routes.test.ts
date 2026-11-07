// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  checkRoute,
  isProjectedAnswersSchema,
  projectedAnswersSchemas,
  type RouteContract,
} from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as contracts from './index.ts';

const routes = Object.values(contracts.formsRoutes) as RouteContract[];

const schemasOf = (route: RouteContract) =>
  Object.values(route.responses).filter((body): body is z.ZodType => body instanceof z.ZodType);

const requestsOf = (route: RouteContract) =>
  [route.params, route.query, route.body].filter(
    (schema): schema is z.ZodType => schema instanceof z.ZodType,
  );

/** The paths inside a schema where a projected answers schema sits. */
function projectedPaths(schema: z.ZodType, path = ''): string[] {
  if (isProjectedAnswersSchema(schema)) return [path];
  const def = schema._zod.def as unknown as Record<string, unknown> & { type: string };
  const inner = (key: string) => projectedPaths(def[key] as z.ZodType, path);
  switch (def.type) {
    case 'object':
      return Object.entries(def['shape'] as Record<string, z.ZodType>).flatMap(([key, value]) =>
        projectedPaths(value, path === '' ? key : `${path}.${key}`),
      );
    case 'array':
      return inner('element');
    case 'optional':
    case 'nullable':
    case 'default':
      return inner('innerType');
    case 'pipe':
      return [...inner('in'), ...inner('out')];
    case 'union':
      return (def['options'] as z.ZodType[]).flatMap((option) => projectedPaths(option, path));
    default:
      return [];
  }
}

/** Every key a request schema names, at any depth. */
function requestKeys(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties') keys.push(...Object.keys(value as object));
        walk(value);
      }
    }
  };
  walk(z.toJSONSchema(schema, { io: 'input' }));
  return keys;
}

describe('forms routes', () => {
  it('are every exported route, each of the forms module, keeping every route rule', () => {
    const exported = Object.values(contracts).filter(
      (value) => typeof value === 'object' && 'audience' in value && 'path' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
    for (const route of routes) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route.module).toBe('forms');
      if (route.permission !== null) expect(route.permission).toMatch(/^forms\./);
    }
  });

  it('are these, under these permissions and scopes', () => {
    expect(
      routes.map(
        (route) =>
          `${route.method} ${route.path} ${String(route.permission)} ${String(route.scope)}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "GET /console/forms forms.forms.manage tenant",
        "POST /console/forms forms.forms.manage tenant",
        "GET /console/forms/:formId forms.forms.manage tenant",
        "PUT /console/forms/:formId/settings forms.forms.manage tenant",
        "PUT /console/forms/:formId/retention forms.retention.manage tenant",
        "GET /console/forms/:formId/draft forms.forms.manage tenant",
        "PUT /console/forms/:formId/draft forms.forms.manage tenant",
        "GET /console/forms/:formId/preview forms.forms.manage tenant",
        "GET /console/forms/:formId/versions forms.forms.manage tenant",
        "GET /console/forms/:formId/versions/:formVersionId forms.forms.manage tenant",
        "POST /console/forms/:formId/versions forms.forms.publish tenant",
        "GET /console/feedback-templates forms.forms.manage tenant",
        "GET /console/feedback-templates/:templateId forms.forms.manage tenant",
        "POST /console/feedback-templates/:templateId/forms forms.forms.manage tenant",
        "GET /console/forms/:formId/responses forms.responses.read tenant",
        "GET /console/forms/:formId/response-totals forms.responses.read tenant",
        "GET /console/form-responses/:responseId forms.responses.read tenant",
        "POST /console/form-responses/lookup forms.responses.read tenant",
        "POST /console/form-responses/:responseId/spam forms.responses.manage tenant",
        "POST /console/form-responses/:responseId/not-spam forms.responses.manage tenant",
        "GET /portal/forms/:formId forms.responses.submit open_form",
        "GET /portal/forms/:formId/draft forms.responses.submit open_form",
        "PUT /portal/forms/:formId/draft forms.responses.submit open_form",
        "POST /portal/forms/:formId/responses forms.responses.submit open_form",
        "GET /portal/form-responses forms.responses.submit own_response",
        "GET /portal/form-responses/:responseId forms.responses.submit own_response",
        "GET /public/tenants/:slug/forms/:formId null null",
        "GET /public/tenants/:slug/forms/:formId/challenge null null",
        "POST /public/tenants/:slug/forms/:formId/responses null null",
      ]
    `);
  });

  it('make every create idempotent, and change retention only after signing in again', () => {
    const creates = routes.filter((route) => 201 in route.responses);
    expect(creates).toEqual([
      contracts.createForm,
      contracts.publishForm,
      contracts.createFormFromTemplate,
      contracts.submitMyResponse,
      contracts.submitPublicResponse,
    ]);
    for (const route of creates) expect(route.idempotent, route.path).toBe(true);
    expect(routes.filter((route) => 'stepUp' in route)).toEqual([contracts.updateFormRetention]);
  });

  it('keep public routes under one tenant slug and form, with no session, permission or scope', () => {
    const open = routes.filter((route) => route.audience === 'public');
    expect(open).toEqual(Object.values(contracts.publicFormRoutes));
    for (const route of open) {
      expect(route.path).toMatch(/^\/public\/tenants\/:slug\/forms\/:formId(?:\/|$)/);
      expect(route).toMatchObject({ permission: null, scope: null });
      expect('session' in route).toBe(false);
    }
  });

  it('take no tenant, acting user or respondent person in any request', () => {
    for (const route of routes) {
      for (const schema of requestsOf(route)) {
        for (const key of requestKeys(schema)) {
          expect(key, route.path).not.toMatch(/tenant|actor|user|member|person|party/i);
        }
      }
    }
  });

  it('never delete, reject or score a response, nor change a published version', () => {
    for (const route of routes) {
      expect(route.method, route.path).not.toBe('DELETE');
      expect(route.path).not.toMatch(/reject|score|decision|delete|remove/);
      if (/versions\/:formVersionId/.test(route.path)) expect(route.method).toBe('GET');
    }
  });

  it('carry answers only through the projection for their audience, at fields classed as answers', () => {
    const projection = {
      console: projectedAnswersSchemas.staff,
      portal: projectedAnswersSchemas.respondent,
    };
    for (const route of routes) {
      for (const schema of requestsOf(route))
        expect(projectedPaths(schema), route.path).toEqual([]);
      for (const schema of schemasOf(route)) {
        const classes = contracts.fieldClassesOf(schema) ?? {};
        const answerKeys = Object.keys(classes).filter((key) => classes[key] === 'answers');
        expect(projectedPaths(schema), route.path).toEqual(answerKeys);
        for (const key of answerKeys) {
          const shape = (schema as z.ZodObject).shape as Record<string, z.ZodType>;
          expect(shape[key], route.path).toBe(projection[route.audience as 'console' | 'portal']);
        }
      }
    }
  });

  it('classify every field of every response, and of each list item', () => {
    for (const route of routes) {
      for (const schema of schemasOf(route)) {
        expect(schema, route.path).toBeInstanceOf(z.ZodObject);
        const { shape } = schema as z.ZodObject;
        expect(Object.keys(contracts.fieldClassesOf(schema) ?? {}), route.path).toEqual(
          Object.keys(shape),
        );
        for (const value of Object.values(shape)) {
          if (!(value instanceof z.ZodArray) || !(value.element instanceof z.ZodObject)) continue;
          expect(Object.keys(contracts.fieldClassesOf(value.element) ?? {}), route.path).toEqual(
            Object.keys(value.element.shape),
          );
        }
      }
    }
  });

  it('answer with strict schemas that refuse unknown keys', () => {
    for (const route of routes) {
      for (const schema of [...schemasOf(route), ...requestsOf(route)]) {
        const root = z.toJSONSchema(schema, { io: 'input' });
        if (root.type === 'object') expect(root.additionalProperties, route.path).toBe(false);
      }
    }
  });
});
