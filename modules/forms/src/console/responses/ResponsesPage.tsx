// SPDX-License-Identifier: AGPL-3.0-or-later

import { call, ProblemError } from '@pixel-scientists/domain/api';
import {
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Link,
  LoadingState,
  NotFoundPage,
  PageHeader,
  Select,
  Tag,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import {
  getForm,
  listFormVersions,
  listResponses,
  responseViews,
  responseRoutes,
} from '../../contracts/index.ts';
import type { ResponseSummary } from '../../contracts/index.ts';
import { formatMoment } from '../format.ts';
import { FormsPage, orMissing, useParam } from '../Page.tsx';
import { usePages, useRemembered } from '../pages.ts';
import { ShowMore } from '../ShowMore.tsx';
import { FORMS_PATH, formPath, responsePath } from '../paths.ts';
import { routeWords, spamWords } from '../words.ts';
import { noFilters, queryOf } from './filters.ts';
import type { Filters } from './filters.ts';
import { Totals } from './Totals.tsx';

const viewWords: Record<Filters['view'], string> = {
  received: 'Received',
  without_check: 'Sent without the browser check',
  spam: 'Marked as spam',
};

/** Reading a form's title and versions takes the permission to manage forms, which someone who only reads responses may lack. */
function ifAllowed<T>(read: Promise<T>): Promise<T | undefined> {
  return read.catch((error: unknown) => {
    if (error instanceof ProblemError && error.status === 403) return undefined;
    throw error;
  });
}

async function load(formId: string) {
  const form = await orMissing(ifAllowed(call(getForm, { params: { formId } })));
  if (form === null) return null;
  const listed = await ifAllowed(call(listFormVersions, { params: { formId } }));
  return { title: form?.title ?? 'Form', versions: listed?.versions ?? [] };
}

function StateTag({ response }: { response: ResponseSummary }) {
  if (response.spamReason !== null) {
    return <Tag tone="danger">{`Spam: ${spamWords[response.spamReason]}`}</Tag>;
  }
  return response.sentWithoutCheck ? (
    <Tag tone="warning">Sent without the browser check</Tag>
  ) : (
    <Tag tone="neutral">Received</Tag>
  );
}

function ResponseTable({ formId, filters }: { formId: string; filters: Filters }) {
  const { state, retry, more } = usePages(
    `responses:${formId}:${JSON.stringify(filters)}`,
    async (cursor) => {
      const { responses, nextCursor } = await call(listResponses, {
        params: { formId },
        query: { view: filters.view, ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
      });
      return { items: responses, next: nextCursor };
    },
  );

  const columns: readonly Column<ResponseSummary>[] = [
    {
      key: 'received',
      header: 'Received',
      rowHeader: true,
      cell: (row) => <Link to={responsePath(formId, row.id)}>{formatMoment(row.submittedAt)}</Link>,
    },
    { key: 'version', header: 'Version', align: 'end', cell: (row) => String(row.version) },
    { key: 'route', header: 'How sent', cell: (row) => routeWords[row.route] },
    { key: 'state', header: 'State', cell: (row) => <StateTag response={row} /> },
  ];

  if (state.status === 'loading') return <LoadingState label="Loading responses" />;
  if (state.status === 'failed') {
    return (
      <EmptyState
        title="We could not load the responses"
        action={<Button onClick={retry}>Try again</Button>}
      >
        <p>{state.message}</p>
      </EmptyState>
    );
  }
  if (state.items.length === 0) {
    return (
      <EmptyState title="No responses to show">
        <p>
          Nothing matches these filters. Clear them to see every response, or publish the form and
          share it so people can answer.
        </p>
      </EmptyState>
    );
  }
  return (
    <>
      <DataTable
        caption="Responses, the newest first"
        captionHidden
        columns={columns}
        rows={state.items}
        rowKey={(row) => row.id}
      />
      <ShowMore noun="responses" state={state} onClick={more} />
    </>
  );
}

function Responses({ formId }: { formId: string }) {
  const { state, retry } = useLoad(load, formId);
  const [filters, setFilters] = useRemembered<Filters>(`responses:${formId}`, noFilters);
  const set = (change: Partial<Filters>) => {
    setFilters({ ...filters, ...change });
  };

  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Responses" />}
      <WhenLoaded state={state} label="Loading responses" retry={retry}>
        {(loaded) =>
          loaded === null ? (
            <NotFoundPage />
          ) : (
            <>
              <PageHeader
                breadcrumbs={[
                  { label: 'Forms', to: FORMS_PATH },
                  { label: loaded.title, to: formPath(formId) },
                  { label: 'Responses' },
                ]}
                title="Responses"
                description="Staff see only the answers the form allows them to read. Marking a response as spam keeps it but leaves it out of lists, exports and reports."
              />
              <Totals formId={formId} filters={filters} />
              <form
                aria-label="Filter responses"
                className="flex flex-wrap items-end gap-x-4 gap-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                }}
              >
                <FormField label="Show">
                  <Select
                    value={filters.view}
                    onChange={(event) => {
                      set({ view: event.target.value as Filters['view'] });
                    }}
                  >
                    {responseViews.map((view) => (
                      <option key={view} value={view}>
                        {viewWords[view]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="How sent">
                  <Select
                    value={filters.route}
                    onChange={(event) => {
                      set({ route: event.target.value as Filters['route'] });
                    }}
                  >
                    <option value="">Either way</option>
                    {responseRoutes.map((route) => (
                      <option key={route} value={route}>
                        {routeWords[route]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Version">
                  <Select
                    value={filters.versionId}
                    onChange={(event) => {
                      set({ versionId: event.target.value });
                    }}
                  >
                    <option value="">Every version</option>
                    {loaded.versions.map(({ id, version }) => (
                      <option key={id} value={id}>
                        {`Version ${String(version)}`}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="From">
                  <Input
                    type="date"
                    value={filters.from}
                    onChange={(event) => {
                      set({ from: event.target.value });
                    }}
                  />
                </FormField>
                <FormField label="To">
                  <Input
                    type="date"
                    value={filters.to}
                    onChange={(event) => {
                      set({ to: event.target.value });
                    }}
                  />
                </FormField>
                <Button
                  onClick={() => {
                    setFilters(noFilters);
                  }}
                >
                  Clear filters
                </Button>
              </form>
              <ResponseTable key={JSON.stringify(filters)} formId={formId} filters={filters} />
            </>
          )
        }
      </WhenLoaded>
    </>
  );
}

export default function ResponsesPage() {
  return (
    <FormsPage permission="forms.responses.read">
      <Responses formId={useParam('formId')} />
    </FormsPage>
  );
}
