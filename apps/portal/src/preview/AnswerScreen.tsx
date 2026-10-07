// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One written section of the application on a screen of its own: its questions
// in small groups, filled in with the saved answers, and a way to carry on or to
// come back later. Answers are saved as they are typed, so nothing is lost.

import { countCharacters, countWords } from '@pixel-scientists/domain/forms';
import {
  Button,
  FormSection,
  SaveStatus,
  SectionProgress,
  useNavigate,
} from '@pixel-scientists/ui';
import type { FormAnswers } from '@pixel-scientists/ui';
import { useState } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { useFocusFragment } from './fragment.ts';
import { answers, isShown } from './form.ts';
import type { FormScreen } from './form.ts';
import { savedAt } from './journey.ts';
import { ScreenHeader } from './parts.tsx';
import { round, sections } from './story.ts';

const helpers = { countWords, countCharacters };

export function AnswerScreen({ screen }: { screen: FormScreen }) {
  const navigate = useNavigate();
  const [given, setGiven] = useState<FormAnswers>(answers);
  useFocusFragment();

  const visible = screen.groups
    .flatMap(({ fields }) => fields)
    .filter(({ id }) => isShown(id, given));

  return (
    <PageColumn>
      <ScreenHeader
        title={screen.title}
        eyebrow={`${round.programme}, ${round.name}`}
        breadcrumbs={[{ label: 'Your application', to: '/application' }, { label: screen.title }]}
        progress={<SectionProgress current={screen.number} total={sections.length} />}
      >
        <p>{screen.intro}</p>
      </ScreenHeader>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          navigate(screen.next);
        }}
        className="flex flex-col gap-10"
      >
        {screen.groups.map((group) => (
          <FormSection
            key={group.id}
            section={group}
            visible={visible}
            answers={given}
            helpers={helpers}
            onChange={(fieldId, value) => {
              setGiven((current) => ({ ...current, [fieldId]: value }));
            }}
          />
        ))}

        <div className="flex flex-col gap-5 border-t border-divider pt-6">
          <div className="flex flex-col gap-1">
            <SaveStatus state={{ status: 'saved', at: savedAt }} />
            <p className="text-sm text-muted">
              We save your answers as you type. You can leave at any time.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              Save and continue
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                navigate('/application');
              }}
            >
              Save and come back later
            </Button>
          </div>
        </div>
      </form>
    </PageColumn>
  );
}
