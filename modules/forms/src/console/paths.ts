// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the forms screens, inside the funder's address. They carry
// ids only: no answer, filter or title ever goes in an address.

export const FORMS_PATH = '/forms';
export const NEW_FORM_PATH = '/forms/new';
export const TEMPLATES_PATH = '/forms/templates';

export const templatePath = (templateId: string) => `/forms/templates/${templateId}`;
export const formPath = (formId: string) => `/forms/${formId}`;
export const settingsPath = (formId: string) => `/forms/${formId}/settings`;
export const responsesPath = (formId: string) => `/forms/${formId}/responses`;
export const responsePath = (formId: string, responseId: string) =>
  `/forms/${formId}/responses/${responseId}`;
