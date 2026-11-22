/**
 * The archetype intents, one line each.
 *
 * `mtg-yddw.2`. One box rather than a list of add-a-row controls, because these
 * are free-form sentences the model reads and the editing a person does to them
 * is rewriting, reordering and deleting a line — all of which a textarea already
 * does. The lines are split on save and blank lines are dropped, so a trailing
 * newline is not an empty note the schema then refuses.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BriefIssue } from './client';
import type { BriefDraft } from './draft';
import { issueNote, panel } from './fields';

export const NOTES_TITLE = 'Archetype intents';

const NOTES_EXPLAIN =
  'One line each, up to ten, handed to the model as written. “Boros wants to attack with two-drops and pay off going wide” is the shape: what the pair is trying to do, not which cards do it.';

export const NOTES_LABEL = 'One intent per line';

export interface NotesPanelProps {
  readonly draft: BriefDraft;
  readonly onChange: (draft: BriefDraft) => void;
  readonly issues: readonly BriefIssue[];
}

export function NotesPanel(props: NotesPanelProps): ReactElement {
  const { draft, onChange, issues } = props;
  return panel(
    NOTES_TITLE,
    NOTES_EXPLAIN,
    createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-design-notes' }, NOTES_LABEL),
    createElement('textarea', {
      id: 'mtg-design-notes',
      className: 'mtg-input',
      'data-pointer': 'archetypeNotes',
      rows: 6,
      value: draft.archetypeNotes.join('\n'),
      onChange: (event: { readonly target: { readonly value: string } }): void => {
        onChange({ ...draft, archetypeNotes: event.target.value.split('\n') });
      },
    }),
    issueNote(issues, 'archetypeNotes', draft.archetypeNotes.join('\n')),
  );
}
