// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { PageHeader } from '@pixel-scientists/ui';

import { createForm } from '../../contracts/index.ts';
import { FormsPage, LinkButton } from '../Page.tsx';
import { FORMS_PATH, TEMPLATES_PATH } from '../paths.ts';
import { CreateForm } from './CreateForm.tsx';

export default function NewFormPage() {
  return (
    <FormsPage>
      <PageHeader
        breadcrumbs={[{ label: 'Forms', to: FORMS_PATH }, { label: 'Create form' }]}
        title="Create form"
        description="Give the form a title. You add questions next, and choose who can answer in its settings."
        actions={<LinkButton to={TEMPLATES_PATH}>Start from a template</LinkButton>}
      />
      <CreateForm
        submit="Create form"
        create={(body, idempotencyKey) =>
          call(createForm, { body }, idempotencyKey === undefined ? {} : { idempotencyKey })
        }
      />
    </FormsPage>
  );
}
