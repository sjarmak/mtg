/**
 * What the set is: its code, its name, the world it is about, and the three
 * numbers the run is sized by.
 *
 * `mtg-yddw.2`. The seed is a field rather than a hidden default because a brief
 * is a *reproducible* input — the same brief at the same seed asks the model the
 * same questions — and a designer comparing two runs needs to be able to hold it
 * still or move it deliberately.
 *
 * The size and the tertiary budget are left blank rather than pre-filled. A
 * number nobody chose, sitting in an editable box, reads as a decision that was
 * made; the derived panel below the editor reports what the run will actually
 * use, which is the honest place for a default to appear.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BriefIssue, Vocabulary } from './client';
import type { BriefDraft } from './draft';
import { panel, textField } from './fields';

export const IDENTITY_TITLE = 'The set';

const IDENTITY_EXPLAIN =
  'The code and the name are printed on every card. The theme is handed to the model verbatim, so it is the single most load-bearing paragraph in the brief: say what the world is and what it feels like, not what mechanics you want.';

export interface IdentityPanelProps {
  readonly draft: BriefDraft;
  readonly onChange: (draft: BriefDraft) => void;
  readonly issues: readonly BriefIssue[];
  /** Null until the server answers; the size hint is the only thing that uses it. */
  readonly vocabulary: Vocabulary | null;
}

function sizeHint(vocabulary: Vocabulary | null): string {
  if (vocabulary === null)
    return 'How many cards the set prints. Left blank, the generator uses its own default.';
  const { min, max, default: fallback } = vocabulary.targetSize;
  return `How many cards the set prints, ${String(min)} to ${String(max)}. Left blank, the run uses ${String(fallback)}.`;
}

export function IdentityPanel(props: IdentityPanelProps): ReactElement {
  const { draft, onChange, issues, vocabulary } = props;
  const field = (key: 'setCode' | 'setName' | 'theme' | 'seed' | 'targetSize' | 'tertiaryBudget') => {
    return (value: string): void => {
      onChange({ ...draft, [key]: value });
    };
  };

  return panel(
    IDENTITY_TITLE,
    IDENTITY_EXPLAIN,
    createElement(
      'div',
      { className: 'mtg-design__row' },
      textField({
        id: 'mtg-design-code',
        label: 'Set code',
        value: draft.setCode,
        onChange: field('setCode'),
        issues,
        pointer: 'setCode',
        placeholder: 'XMP',
        hint: 'Three to five uppercase letters or digits.',
      }),
      textField({
        id: 'mtg-design-name',
        label: 'Set name',
        value: draft.setName,
        onChange: field('setName'),
        issues,
        pointer: 'setName',
        placeholder: 'the flagship set',
      }),
    ),
    textField({
      id: 'mtg-design-theme',
      label: 'Theme',
      value: draft.theme,
      onChange: field('theme'),
      issues,
      pointer: 'theme',
      rows: 6,
      placeholder: 'A drowned archipelago where the tide remembers what it took.',
      hint: 'Up to 600 characters, handed to the model as written.',
    }),
    createElement(
      'div',
      { className: 'mtg-design__row' },
      textField({
        id: 'mtg-design-seed',
        label: 'Seed',
        value: draft.seed,
        onChange: field('seed'),
        issues,
        pointer: 'seed',
        hint: 'The same brief at the same seed asks the same questions.',
      }),
      textField({
        id: 'mtg-design-size',
        label: 'Target size',
        value: draft.targetSize,
        onChange: field('targetSize'),
        issues,
        pointer: 'targetSize',
        hint: sizeHint(vocabulary),
      }),
      textField({
        id: 'mtg-design-tertiary',
        label: 'Tertiary budget',
        value: draft.tertiaryBudget,
        onChange: field('tertiaryBudget'),
        issues,
        pointer: 'tertiaryBudget',
        hint: 'How many cards may sit outside their color’s primary and secondary slice. Left blank, it is derived from the size.',
      }),
    ),
  );
}
