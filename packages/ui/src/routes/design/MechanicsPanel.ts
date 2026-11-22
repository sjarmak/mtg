/**
 * The mechanics the set is asked to be about, and the vocabulary each one is
 * allowed to reach for.
 *
 * `mtg-yddw.2`. A mechanic here is not a rules text: it is a name, a sentence
 * saying what it does, and a selection out of the four closed lists the kernel
 * can actually run. That is the containment invariant made visible — a designer
 * picks from what the engine enforces, so a brief cannot ask the generator for a
 * mechanic no card could express.
 *
 * The four lists come off `/design-api/vocabulary`. They are not copied into
 * this page: with no server the chips say so and the name and description are
 * still editable, because most of writing a mechanic is writing the sentence.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BriefIssue, Vocabulary } from './client';
import { EMPTY_MECHANIC } from './draft';
import type { BriefDraft, MechanicDraft } from './draft';
import { chipsField, panel, removedAt, replacedAt, textField, toggled } from './fields';

export const MECHANICS_TITLE = 'Mechanics';

const MECHANICS_EXPLAIN =
  'One to six. Each is a name, a sentence the model reads, and the keywords, effects, abilities and triggers it may use. The skeleton below shows how far each one actually reaches into the set.';

export const ADD_MECHANIC_LABEL = 'Add a mechanic';

export const REMOVE_MECHANIC_LABEL = 'Remove';

const NO_VOCABULARY = 'The design server has not answered, so this closed list is not on screen yet.';

export interface MechanicsPanelProps {
  readonly draft: BriefDraft;
  readonly onChange: (draft: BriefDraft) => void;
  readonly issues: readonly BriefIssue[];
  readonly vocabulary: Vocabulary | null;
}

type ChipList = 'keywords' | 'effectKinds' | 'abilityKinds' | 'triggerConditions' | 'colors';

const CHIP_LABELS: Readonly<Record<ChipList, string>> = {
  keywords: 'Keywords',
  effectKinds: 'Effects',
  abilityKinds: 'Ability kinds',
  triggerConditions: 'Triggers',
  colors: 'Colors',
};

function optionsFor(vocabulary: Vocabulary | null, list: ChipList): readonly string[] {
  if (vocabulary === null) return [];
  return vocabulary[list];
}

export function MechanicsPanel(props: MechanicsPanelProps): ReactElement {
  const { draft, onChange, issues, vocabulary } = props;

  const replace = (index: number, mechanic: MechanicDraft): void => {
    onChange({ ...draft, mechanics: replacedAt(draft.mechanics, index, mechanic) });
  };

  const mechanics = draft.mechanics.map((mechanic, index) => {
    const at = `mechanics.${String(index)}`;
    return createElement(
      'article',
      {
        key: at,
        className: 'mtg-design__item',
        'data-refused': issues.some((i) => i.pointer.startsWith(at)),
      },
      createElement(
        'div',
        { className: 'mtg-design__row' },
        textField({
          id: `${at}-name`,
          label: 'Name',
          value: mechanic.name,
          onChange: (value: string): void => {
            replace(index, { ...mechanic, name: value });
          },
          issues,
          pointer: `${at}.name`,
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            // The floor is one, and a button that removes the last mechanic
            // would leave the panel with nothing to draw and the schema with a
            // refusal about a list nobody can see. Hidden rather than disabled:
            // a disabled control invites a person to work out why.
            hidden: draft.mechanics.length <= 1,
            onClick: (): void => {
              onChange({ ...draft, mechanics: removedAt(draft.mechanics, index) });
            },
          },
          REMOVE_MECHANIC_LABEL,
        ),
      ),
      textField({
        id: `${at}-description`,
        label: 'What it does',
        value: mechanic.description,
        onChange: (value: string): void => {
          replace(index, { ...mechanic, description: value });
        },
        issues,
        pointer: `${at}.description`,
        rows: 3,
      }),
      ...(Object.keys(CHIP_LABELS) as readonly ChipList[]).map((list) => {
        const options = optionsFor(vocabulary, list);
        return chipsField({
          label: CHIP_LABELS[list],
          options,
          selected: mechanic[list],
          onToggle: (option: string): void => {
            replace(index, { ...mechanic, [list]: toggled(mechanic[list], option, options) });
          },
          issues,
          pointer: `${at}.${list}`,
          absent: NO_VOCABULARY,
        });
      }),
    );
  });

  return panel(
    MECHANICS_TITLE,
    MECHANICS_EXPLAIN,
    ...mechanics,
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            onChange({ ...draft, mechanics: [...draft.mechanics, EMPTY_MECHANIC] });
          },
        },
        ADD_MECHANIC_LABEL,
      ),
    ),
  );
}
