// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What every page about one application shares: the heading while it loads,
// what to say when it is not there, and its place in the breadcrumbs.

import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName } from '@pixel-scientists/ui';
import type { BreadcrumbItem } from '@pixel-scientists/ui';

import { APPLICATIONS_PATH, applicationPath, submittedPath } from '../paths.ts';
import type { Heading, Missing, View } from './parts.tsx';

export const loadingApplication: Heading = {
  title: 'Your application',
  breadcrumbs: [
    { label: 'Your applications', to: APPLICATIONS_PATH },
    { label: 'Your application' },
  ],
};

export const noApplication: Missing = {
  text: 'We cannot find this application. It may belong to someone else.',
  to: APPLICATIONS_PATH,
  link: 'Go to your applications',
};

/** The programme and round an application is for, as its pages name it: "Community Grants, Spring 2027". */
export const nameOf = ({ round }: Pick<Application, 'round'>): string =>
  `${round.programmeTitle}, ${round.title}`;

/** Your applications, then this application, then the page, if it is not the application itself. */
export function crumbs(application: Application, page?: string): BreadcrumbItem[] {
  return [
    { label: 'Your applications', to: APPLICATIONS_PATH },
    page === undefined
      ? { label: nameOf(application) }
      : { label: nameOf(application), to: applicationPath(application.id) },
    ...(page === undefined ? [] : [{ label: page }]),
  ];
}

/** The page for someone who opens a draft's page after the application is sent or withdrawn. */
export function notDraft(application: Application): View {
  return {
    heading: {
      title: 'Your application',
      breadcrumbs: crumbs(application),
      intro: <p>You cannot change this application, because you have sent it or withdrawn it.</p>,
    },
    body: (
      <div>
        <Link
          to={submittedPath(application.id)}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          See your application
        </Link>
      </div>
    ),
  };
}
