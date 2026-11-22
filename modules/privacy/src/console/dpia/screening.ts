// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screening questions a DPIA starts with. Answers are stored against each
// question's stable id (rule 7), so rewording a question here never changes
// what an earlier DPIA says it answered.

export const screeningItems = [
  {
    id: 'q_special',
    text: 'Does it use special category or criminal offence data on a large scale?',
  },
  { id: 'q_vulnerable', text: 'Does it involve children or other vulnerable people?' },
  {
    id: 'q_monitoring',
    text: 'Does it monitor people systematically, such as tracking where they are or what they do?',
  },
  { id: 'q_profiling', text: 'Does it profile people or make automated decisions about them?' },
  { id: 'q_newtech', text: 'Does it use new technology?' },
  { id: 'q_matching', text: 'Does it match or combine data from different sources?' },
  {
    id: 'q_unexpected',
    text: 'Does it collect data in a way people may not expect or cannot easily avoid?',
  },
  { id: 'q_denial', text: 'Could it stop people getting a grant or another service?' },
] as const;
