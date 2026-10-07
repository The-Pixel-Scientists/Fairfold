// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: where every other submission and review leads. The previews
// build one of each in full, so this says so and links to it.

import {
  Link,
  PageHeader,
  Tag,
  buttonClassName,
  useLocation,
  useParams,
} from '@pixel-scientists/ui';

import { reference as reviewReference } from './blind.ts';
import { rows } from './data.ts';
import { reference as submissionReference } from './featured.ts';
import { ArrowRightIcon } from './icons.tsx';

const projects = new Map(rows.map((row) => [row.reference, row.project]));

export default function StandIn() {
  const { reference = '' } = useParams();
  const reviewing = useLocation().pathname.startsWith('/reviews');
  const example = reviewing ? reviewReference : submissionReference;
  const name = projects.get(example) ?? example;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          reviewing
            ? { label: 'My reviews', to: '/reviews' }
            : { label: 'Submissions', to: '/submissions' },
          { label: reference },
        ]}
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title={projects.get(reference) ?? reference}
        description={
          reviewing
            ? 'Every review opens the scoring workspace: the application, answered blind, beside your scores.'
            : 'Every submission opens its own page: the application, eligibility, due diligence, reviews, notes and history.'
        }
      />
      <p className="max-w-prose text-body text-muted">
        This preview builds one in full, to show what each holds: {name},{' '}
        <span className="whitespace-nowrap tabular-nums">{example}</span>.
      </p>
      <div>
        <Link
          to={reviewing ? `/reviews/${example}` : `/submissions/${example}`}
          className={buttonClassName('primary', 'no-underline')}
        >
          Open {name}
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
    </div>
  );
}
