// SPDX-License-Identifier: AGPL-3.0-or-later

import { call } from '@pixel-scientists/domain/api';
import { moduleIds, modules } from '@pixel-scientists/domain/platform';
import {
  asProblem,
  Button,
  DataTable,
  FormField,
  Input,
  Panel,
  Select,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { completeRequestTask, createRequestTask, listRequestTasks } from '../../contracts/index.ts';
import type { RequestTask } from '../../contracts/index.ts';
import { useRead } from '../hooks.ts';
import { loadMembers } from '../loaders.ts';
import { ActionDialog, Reading, text } from '../parts.tsx';
import { formatDate } from '../words.ts';

const loadTasks = (requestId: string) =>
  call(listRequestTasks, { params: { requestId } }).then(({ tasks }) => tasks);

const toolWords = Object.fromEntries(moduleIds.map((id) => [id, modules[id].label]));

/** The work a request needs, each task assigned to a member the server lists. The assigner is the session's member. */
export function TasksPanel({ requestId }: { requestId: string }) {
  const { state, reload, set } = useRead(loadTasks, requestId);
  const team = useRead(loadMembers);
  const members = team.state.status === 'ready' ? team.state.value : null;
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameOf = (id: string | null) =>
    id === null ? 'No one' : (members?.find((member) => member.id === id)?.name ?? 'A team member');

  async function complete(task: RequestTask) {
    setFailure(null);
    try {
      const done = await call(completeRequestTask, { params: { requestId, taskId: task.id } });
      if (state.status === 'ready') {
        set(state.value.map((found) => (found.id === done.id ? done : found)));
      }
    } catch (error) {
      setFailure(asProblem(error)?.detail ?? 'Something went wrong. Try again.');
    }
  }

  return (
    <Panel
      title="Tasks"
      actions={
        <Button
          onClick={() => {
            setAdding(true);
          }}
        >
          Add task
        </Button>
      }
    >
      {failure !== null && (
        <p role="alert" className="font-medium text-danger">
          {failure}
        </p>
      )}
      <Reading state={state} label="Loading tasks" retry={reload} inline>
        {(tasks) => (
          <DataTable
            caption="Tasks for this request"
            captionHidden
            rows={tasks}
            rowKey={(task) => task.id}
            empty={
              <p className="p-4 text-body text-muted">
                No tasks yet. Add one for each check, such as looking through grants records.
              </p>
            }
            columns={[
              {
                key: 'title',
                header: 'Task',
                rowHeader: true,
                cell: (task) => <span className="whitespace-normal">{task.title}</span>,
              },
              {
                key: 'assignee',
                header: 'Assigned to',
                cell: (task) => nameOf(task.assigneeMembershipId),
              },
              {
                key: 'tool',
                header: 'Tool',
                cell: (task) => (task.moduleId === null ? 'Any' : toolWords[task.moduleId]),
              },
              {
                key: 'due',
                header: 'Due',
                cell: (task) => (task.dueOn === null ? 'No date' : formatDate(task.dueOn)),
              },
              {
                key: 'done',
                header: 'Status',
                cell: (task) =>
                  task.completedAt === null ? (
                    <Button
                      aria-label={`Mark done: ${task.title}`}
                      onClick={() => {
                        void complete(task);
                      }}
                    >
                      Mark done
                    </Button>
                  ) : (
                    'Done'
                  ),
              },
            ]}
          />
        )}
      </Reading>
      <ActionDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title="Add task"
        submit="Add task"
        fields={['title', 'assigneeMembershipId', 'moduleId', 'dueOn']}
        action={async (data, idempotencyKey) => {
          const task = await call(createRequestTask, {
            params: { requestId },
            body: {
              title: text(data, 'title'),
              assigneeMembershipId: text(data, 'assigneeMembershipId') || null,
              moduleId: text(data, 'moduleId') || null,
              dueOn: text(data, 'dueOn') || null,
            },
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          });
          if (state.status === 'ready') set([...state.value, task]);
          setAdding(false);
        }}
      >
        {(errorFor) => (
          <>
            <FormField label="What needs doing" id="title" error={errorFor('title')}>
              <Input name="title" />
            </FormField>
            {members !== null && (
              <FormField
                label="Assign to"
                id="assigneeMembershipId"
                optional
                error={errorFor('assigneeMembershipId')}
              >
                <Select name="assigneeMembershipId" defaultValue="">
                  <option value="">No one yet</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name ?? member.email}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label="Tool" id="moduleId" optional error={errorFor('moduleId')}>
              <Select name="moduleId" defaultValue="">
                <option value="">Any tool</option>
                {Object.entries(toolWords).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Due" id="dueOn" optional error={errorFor('dueOn')}>
              <Input name="dueOn" type="date" />
            </FormField>
          </>
        )}
      </ActionDialog>
    </Panel>
  );
}
