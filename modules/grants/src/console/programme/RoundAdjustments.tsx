// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round's adjustments: who has more time or the alternative route, and the
// applications staff are filling in for applicants. Reasons are shown here
// and on the submission page, nowhere else.

import {
  Button,
  DataTable,
  EmptyState,
  Link,
  useCan,
  useLoad,
  useNavigate,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import type { Adjustment, AdjustmentKind, Round } from '../../contracts/index.ts';
import { AdjustmentList } from '../submissions/adjustments/AdjustmentList.tsx';
import { ChooseOrganisation } from '../submissions/adjustments/ChooseOrganisation.tsx';
import type { OrganisationChoice } from '../submissions/adjustments/ChooseOrganisation.tsx';
import { GrantDialog } from '../submissions/adjustments/GrantDialog.tsx';
import { loadRoundAdjustments } from '../submissions/adjustments/loaders.ts';
import { RevokeDialog } from '../submissions/adjustments/RevokeDialog.tsx';
import { useNotice } from '../submissions/adjustments/useNotice.tsx';
import { StartDialog } from '../submissions/assisted/StartDialog.tsx';
import type { StartTarget } from '../submissions/assisted/StartDialog.tsx';
import { loadAssistedDrafts } from '../submissions/assisted/loaders.ts';
import { assistedPath } from '../submissions/paths.ts';
import { formatMoment } from './format.ts';
import { Section } from './Page.tsx';

const loadRound = async (roundId: string) => ({
  adjustments: (await loadRoundAdjustments(roundId)).adjustments,
});

function Drafts({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadAssistedDrafts, roundId);
  return (
    <Section title="Applications staff are filling in">
      <WhenLoaded state={state} label="Loading applications" retry={retry}>
        {({ applications }) => (
          <DataTable
            caption="Applications staff are filling in"
            captionHidden
            columns={[
              {
                key: 'organisation',
                header: 'Organisation',
                rowHeader: true,
                cell: ({ organisation }) => organisation.name,
              },
              {
                key: 'contact',
                header: 'Applicant',
                cell: ({ contact }) => contact.name ?? 'Not given',
              },
              {
                key: 'saved',
                header: 'Last saved',
                cell: ({ updatedAt }) => formatMoment(updatedAt),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'end',
                cell: ({ id, organisation }) => (
                  <Link to={assistedPath(id)}>
                    Continue
                    <span className="sr-only"> the application for {organisation.name}</span>
                  </Link>
                ),
              },
            ]}
            rows={applications}
            rowKey={({ id }) => id}
            empty={
              <EmptyState title="Nothing in progress" headingLevel="h3">
                <p>
                  Start an application from an organisation that has the alternative route. It
                  appears here until you submit it.
                </p>
              </EmptyState>
            }
          />
        )}
      </WhenLoaded>
    </Section>
  );
}

function Body({ round, initial }: { round: Round; initial: readonly Adjustment[] }) {
  const navigate = useNavigate();
  const assist = useCan('grants.applications.assist');
  const [adjustments, setAdjustments] = useState(initial);
  const [choosing, setChoosing] = useState<AdjustmentKind | null>(null);
  const [giving, setGiving] = useState<{
    kind: AdjustmentKind;
    organisation: OrganisationChoice;
  } | null>(null);
  const [removing, setRemoving] = useState<Adjustment | null>(null);
  const [starting, setStarting] = useState<StartTarget | null>(null);
  const { notice, say, focus } = useNotice();

  const refresh = (said: string) => {
    say(said);
    void loadRoundAdjustments(round.id).then(
      ({ adjustments: next }) => {
        setAdjustments(next);
        focus();
      },
      () => {
        say(`${said} Refresh the page to see the latest.`);
        focus();
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="More time and the alternative route"
        action={
          <span className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setChoosing('deadline_extension');
              }}
            >
              Give more time
            </Button>
            <Button
              onClick={() => {
                setChoosing('alternative_route');
              }}
            >
              Let staff submit for an organisation
            </Button>
          </span>
        }
      >
        <p className="max-w-prose text-body text-muted">
          An applicant sees only their new closing time. Reasons are for staff.
        </p>
        {notice}
        <AdjustmentList
          adjustments={adjustments}
          caption="Adjustments in this round"
          showOrganisation
          onRevoke={setRemoving}
          rowActions={(adjustment) =>
            assist && adjustment.kind === 'alternative_route' ? (
              <Button
                onClick={() => {
                  setStarting({ roundId: round.id, organisation: adjustment.organisation });
                }}
              >
                Start application
                <span className="sr-only"> for {adjustment.organisation.name}</span>
              </Button>
            ) : null
          }
          empty={
            <EmptyState title="No adjustments" headingLevel="h3">
              <p>
                Give an organisation more time, or let staff submit for an applicant who cannot use
                the portal.
              </p>
            </EmptyState>
          }
        />
      </Section>
      {assist && <Drafts roundId={round.id} />}
      <ChooseOrganisation
        open={choosing !== null}
        onOpenChange={(open) => {
          if (!open) setChoosing(null);
        }}
        onChosen={(organisation) => {
          if (choosing !== null) setGiving({ kind: choosing, organisation });
          setChoosing(null);
        }}
      />
      <GrantDialog
        open={giving !== null}
        onOpenChange={(open) => {
          if (!open) setGiving(null);
        }}
        kind={giving?.kind ?? 'deadline_extension'}
        target={{
          roundId: round.id,
          organisation: giving?.organisation ?? { id: '', name: '' },
          closesAt: round.closesAt,
          timeZone: round.timeZone,
        }}
        onGranted={(adjustment) => {
          setGiving(null);
          refresh(`Adjustment given to ${adjustment.organisation.name}.`);
        }}
      />
      <RevokeDialog
        adjustment={removing}
        onClose={() => {
          setRemoving(null);
        }}
        onRevoked={(adjustment) => {
          setRemoving(null);
          refresh(`Adjustment removed for ${adjustment.organisation.name}.`);
        }}
      />
      <StartDialog
        target={starting}
        onClose={() => {
          setStarting(null);
        }}
        onStarted={(applicationId) => {
          navigate(assistedPath(applicationId));
        }}
      />
    </div>
  );
}

/** The round's adjustments, with a way to give and remove them and to start an application for an applicant. */
export function RoundAdjustments({ round }: { round: Round }) {
  const { state, retry } = useLoad(loadRound, round.id);
  return (
    <WhenLoaded state={state} label="Loading adjustments" retry={retry}>
      {({ adjustments }) => <Body round={round} initial={adjustments} />}
    </WhenLoaded>
  );
}
