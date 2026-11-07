// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in beneficiary feedback templates (roadmap 3.13), held here as
// versioned definitions. Each question is classified: ratings are internal,
// and free text, which may name people, is personal. None asks for special
// category data, a file or an answer counted only in reports, so every
// template can be published for anyone to answer (ADR 0036). A change to a
// template is a new version; forms already made from it keep their copy.
//
// `forms.forms.manage` lists and reads them, and creates a form whose draft
// is a template's definition (`forms.form.created`).

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { formDefinitionSchema, type FormDefinition } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { formSchema, formSettingsInputSchema } from './forms.ts';
import { classified } from './schemas.ts';

const quality = [
  { value: 'very_good', label: 'Very good' },
  { value: 'good', label: 'Good' },
  { value: 'neither', label: 'Neither good nor poor' },
  { value: 'poor', label: 'Poor' },
  { value: 'very_poor', label: 'Very poor' },
];

const rating = (id: string, label: string) =>
  ({ id, type: 'single_choice', label, classification: 'internal', options: quality }) as const;

const comments = (id: string, label: string, hint: string) =>
  ({ id, type: 'long_text', label, hint, maxWords: 500, classification: 'personal' }) as const;

interface FeedbackTemplate {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly definition: FormDefinition;
}

function template(id: string, title: string, description: string, input: unknown) {
  const definition = formDefinitionSchema.parse(input);
  return { id, version: 1, title, description, definition } as const satisfies FeedbackTemplate;
}

export const feedbackTemplates = [
  template(
    '0b6f3c1e-58a2-4d1b-9c47-2e8d5f1a7b30',
    'Feedback on a service',
    'Ask people what they thought of a service you run or fund.',
    {
      sections: [
        {
          id: 's_service',
          title: 'Your feedback',
          fields: [
            rating('f_overall', 'Overall, how good was the service?'),
            comments('f_helped', 'What helped you most?', 'Tell us in your own words.'),
            comments('f_better', 'What could we do better?', 'Tell us in your own words.'),
            {
              id: 'f_recommend',
              type: 'yes_no',
              label: 'Would you suggest the service to a friend?',
              classification: 'internal',
            },
          ],
        },
      ],
    },
  ),
  template(
    '5e2a9d74-0c3f-4b86-a1d5-93f7c2e4b618',
    'Feedback after an event',
    'Ask people who came to an event what worked and what to change.',
    {
      sections: [
        {
          id: 's_event',
          title: 'About the event',
          fields: [
            rating('f_overall', 'Overall, how good was the event?'),
            comments('f_useful', 'What was most useful?', 'Tell us in your own words.'),
            comments('f_change', 'What should we change next time?', 'Tell us in your own words.'),
            {
              id: 'f_again',
              type: 'yes_no',
              label: 'Would you come to an event like this again?',
              classification: 'internal',
            },
          ],
        },
      ],
    },
  ),
  template(
    'c4d81b2f-7e65-4a03-8f9c-1b5e6a2d3c47',
    'Check in on how things have changed',
    'Ask people how your support has made a difference to them.',
    {
      sections: [
        {
          id: 's_change',
          title: 'What has changed',
          fields: [
            rating('f_support', 'How good has the support been?'),
            {
              id: 'f_difference',
              type: 'single_choice',
              label: 'How much difference has the support made to you?',
              classification: 'internal',
              options: [
                { value: 'a_lot', label: 'A lot' },
                { value: 'some', label: 'Some' },
                { value: 'a_little', label: 'A little' },
                { value: 'none', label: 'None' },
              ],
            },
            comments(
              'f_changed',
              'What has changed for you?',
              'Tell us about anything, big or small.',
            ),
            comments(
              'f_next',
              'Is there anything else you need from us?',
              'Leave this blank if not.',
            ),
          ],
        },
      ],
    },
  ),
] as const;

const templateShape = {
  id: idSchema,
  version: z.int(),
  title: z.string(),
  description: z.string(),
};

const templateSummarySchema = classified(z.strictObject({ ...templateShape, questions: z.int() }), {
  id: 'public',
  version: 'public',
  title: 'public',
  description: 'public',
  questions: 'public',
});

export const feedbackTemplateListSchema = classified(
  z.strictObject({ templates: z.array(templateSummarySchema) }),
  { templates: 'public' },
);

export const feedbackTemplateSchema = classified(
  z.strictObject({ ...templateShape, definition: formDefinitionSchema }),
  { id: 'public', version: 'public', title: 'public', description: 'public', definition: 'public' },
);

export type FeedbackTemplateDetail = z.infer<typeof feedbackTemplateSchema>;

const manage = {
  audience: 'console',
  module: 'forms',
  scope: 'tenant',
  permission: 'forms.forms.manage',
} as const;

const one = { params: z.strictObject({ templateId: idSchema }) } as const;

export const listFeedbackTemplates = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/feedback-templates',
  summary: 'List the built-in feedback templates',
  responses: { 200: feedbackTemplateListSchema },
});

export const getFeedbackTemplate = defineRoute({
  ...manage,
  ...one,
  method: 'GET',
  path: '/console/feedback-templates/:templateId',
  summary: 'Read a feedback template with its questions',
  responses: { 200: feedbackTemplateSchema },
});

export const createFormFromTemplate = defineRoute({
  ...manage,
  ...one,
  method: 'POST',
  idempotent: true,
  path: '/console/feedback-templates/:templateId/forms',
  summary: "Create a form whose draft is the template's latest version",
  body: formSettingsInputSchema,
  responses: { 201: formSchema },
});

export const templateRoutes = {
  listFeedbackTemplates,
  getFeedbackTemplate,
  createFormFromTemplate,
} as const;
