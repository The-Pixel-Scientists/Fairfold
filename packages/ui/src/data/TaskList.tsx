// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';

import { cx } from '../cx.ts';
import { Tag } from '../layout/index.ts';
import type { TagTone } from '../layout/index.ts';
import { Link } from '../router/Link.tsx';

export type TaskStatus = 'not-started' | 'in-progress' | 'completed' | 'cannot-start';

export interface TaskItem {
  /** The section's name, such as "Budget". */
  label: string;
  /** A path inside the app. Leave it out for a section that cannot be opened yet. */
  to?: string;
  status: TaskStatus;
  /** Why a section cannot start, or what it needs. Read with the status. */
  hint?: string;
}

export interface TaskListProps {
  /** Names the list, such as "Application sections". */
  label: string;
  items: readonly TaskItem[];
}

const statuses: Record<TaskStatus, { words: string; tone: TagTone }> = {
  'not-started': { words: 'Not started', tone: 'neutral' },
  'in-progress': { words: 'In progress', tone: 'info' },
  completed: { words: 'Completed', tone: 'success' },
  'cannot-start': { words: 'Cannot start yet', tone: 'neutral' },
};

/**
 * The sections of a long application and where each stands. A section with a
 * path is a link, and the link is described by its status and hint, so a
 * screen reader says "Budget, link, Not started". The status is words, with
 * a tag to back them up.
 */
export function TaskList({ label, items }: TaskListProps) {
  const baseId = useId();

  return (
    <ul role="list" aria-label={label} className="divide-y divide-divider border-y border-divider">
      {items.map((item, index) => {
        const statusId = `${baseId}-${String(index)}-status`;
        const hintId = `${baseId}-${String(index)}-hint`;
        const { words, tone } = statuses[item.status];
        return (
          <li
            key={item.label}
            className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-0.5 py-3"
          >
            {item.to === undefined ? (
              <span className="min-w-0 text-body text-muted">{item.label}</span>
            ) : (
              <Link
                to={item.to}
                aria-describedby={cx(statusId, item.hint !== undefined && hintId)}
                className="min-w-0 justify-self-start text-body font-medium"
              >
                {item.label}
              </Link>
            )}
            {item.hint !== undefined && (
              <p id={hintId} className="col-start-1 text-sm text-muted">
                {item.hint}
              </p>
            )}
            <span id={statusId} className="col-start-2 row-start-1 row-span-2">
              <Tag tone={tone}>{words}</Tag>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
