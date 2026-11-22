/**
 * The form: a prompt box, and the fields that make it answerable.
 *
 * The arrangement is the decision `mtg-yp33` settled. A build takes minutes and
 * costs model spend, so a conversation is the wrong shape for it — a chat over
 * something that answers in four minutes reads as broken. What fits is a form
 * you fill in, a build you name, and a shelf you compare against, where "make it
 * cheaper" is a rebuild you can diff rather than a sentence in a transcript
 * nobody can re-run.
 *
 * So the prompt is one field among many rather than the whole interface. It
 * carries what only prose can carry — "a fast white deck that goes wide and
 * finishes with an anthem" — and every fielded control beside it is a criterion
 * the person can state exactly instead of hoping the sentence conveyed it.
 *
 * # What is fielded and what is not, and why the line falls there
 *
 * Fielded: which sets, which colors, deck size, land count, copy limit, mana
 * value ceiling. Every one is a *fact* somebody can assert and code can enforce
 * — `@mtg/decklab`'s `candidates.ts` calls these structural, and settles them
 * without asking a model.
 *
 * Not fielded, and free text on purpose: archetype, themes, power band. These
 * are judgments about what a card *does*, and constraining them to a menu here
 * would move the judgment into this file. A dropdown of twelve archetypes is a
 * claim that there are twelve, which is exactly the hardcoded taxonomy the
 * project's ZFC rule forbids.
 *
 * The land count is the one field that is both, and its note says so: state it
 * and it wins outright, leave it blank and the model decides from the curve and
 * the plan. That is `@mtg/decklab`'s own arrangement, restated where somebody
 * can act on it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { COLORS } from '@mtg/dsl';
import { colorWord } from '../../../card/symbols';
import { symbolizeLine } from '../../../card/SymbolText';
import { heading } from '../grouping';
import type { Issue, WorkbenchSet } from './client';
import { chipsField, numberField, textField, toggled } from './fields';
import type { WorkbenchDraft } from './draft';

export const BUILD_BUTTON_LABEL = 'Build this deck';
export const REBUILD_BUTTON_LABEL = 'Build as a new variation';

/**
 * Said where the build button would be when the server cannot spend.
 *
 * The figure is $7 and not the $0.50 this said first (`mtg-yp33.6`): `@mtg/decklab`'s
 * `select.ts` records two live selection rounds at $0.4735 and $0.4980, and a
 * 60-card deck is sized at twelve rounds, so fifty cents bought exactly one and
 * every deck built under it stopped part-way by construction. A number a note
 * tells somebody to type has to be a number that finishes the thing the note is
 * about.
 */
export const UNARMED_NOTE =
  'This lab was started without a spend ceiling, so it builds nothing. Every build spends model ' +
  'budget, and there is deliberately no way to start one by forgetting a flag. Restart with ' +
  '`npm run deckbench -- --max-usd 7`, which is about what one 60-card deck costs to choose: a ' +
  'selection round runs near $0.50 and a deck that size is sized at twelve of them.';

/** Said under the sets row. The one sentence that explains the whole pool rule. */
export const SETS_HINT =
  'Decks are built from cards this kernel can run, which is a generated set or a reduced ' +
  'reference build. A deck of real printings could be priced and validated but never played here.';

export interface CriteriaFormProps {
  readonly draft: WorkbenchDraft;
  readonly onChange: (draft: WorkbenchDraft) => void;
  readonly sets: readonly WorkbenchSet[];
  readonly issues: readonly Issue[];
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  /** Whether a build can be started at all: false when the server is unarmed. */
  readonly canBuild: boolean;
  /** True while a build is running: one at a time, because each spends. */
  readonly building: boolean;
  readonly onBuild: () => void;
  /**
   * Whatever the build itself refused, drawn inside the pinned block rather
   * than after it.
   *
   * The button is a sticky footer of a pane that scrolls; a sentence written as
   * its sibling lands at the end of that scroll. Measured: pressing Build on a
   * pool the server refuses put the reason at y=1426 in an 836px box, so the
   * only visible effect of the press was that nothing happened. Same defect the
   * Play refusal had one pane over.
   */
  readonly refusals?: readonly string[];
  /** Set when this build would be a variation of an existing one. */
  readonly parentName?: string;
}

export function CriteriaForm(props: CriteriaFormProps): ReactElement {
  const { draft, onChange, issues } = props;
  const set = (patch: Partial<WorkbenchDraft>): void => {
    onChange({ ...draft, ...patch });
  };

  return createElement(
    'form',
    {
      className: 'mtg-workbench__form',
      onSubmit: (event: { preventDefault: () => void }): void => {
        event.preventDefault();
        if (props.canBuild && !props.building) props.onBuild();
      },
    },

    textField({
      id: 'workbench-prompt',
      label: 'What do you want',
      value: draft.prompt,
      onChange: (value) => {
        set({ prompt: value });
      },
      issues,
      pointer: '/prompt',
      rows: 3,
      placeholder: 'a fast white deck that goes wide and finishes with an anthem',
      hint: 'Your own words, carried to the model exactly as typed. Nothing here is parsed by code.',
    }),

    chipsField({
      label: 'Sets',
      pointer: '/sets',
      issues,
      options: props.sets.map((entry) => ({
        value: entry.code,
        label: entry.name,
        note: `${String(entry.cardCount)} cards`,
      })),
      selected: draft.sets,
      onToggle: (value) => {
        set({ sets: toggled(draft.sets, value) });
      },
      absent:
        'No set is staged. Produce one with `npm run slice`, or ' +
        '`npm run reference:reduced -- --out out/reference`.',
      hint: SETS_HINT,
    }),

    chipsField({
      label: 'Colors',
      pointer: '/colors',
      issues,
      // The word from the symbol registry and the pip painted from it, so the
      // only spelling of "white" on this surface is the rules text's and the
      // only drawing of `{W}` is the card face's. This was a fifth color table
      // and a printed pair of braces.
      options: COLORS.map((color) => ({
        value: color,
        label: heading(colorWord(color) ?? color),
        note: createElement('span', null, ...symbolizeLine(`{${color}}`)),
      })),
      selected: draft.colors,
      onToggle: (value) => {
        set({ colors: toggled(draft.colors, value) });
      },
      absent: 'no colors',
      hint: 'Leave every color off and the model chooses the deck’s identity itself.',
    }),

    createElement(
      'div',
      { className: 'mtg-workbench__numbers' },
      numberField({
        id: 'workbench-size',
        label: 'Deck size',
        value: draft.size,
        onChange: (value) => {
          set({ size: value });
        },
        issues,
        pointer: '/size',
        min: 40,
        max: 250,
      }),
      numberField({
        id: 'workbench-lands',
        label: 'Lands',
        value: draft.landCount,
        onChange: (value) => {
          set({ landCount: value });
        },
        issues,
        pointer: '/landCount',
        min: 0,
        max: 60,
        hint: 'Blank lets the model decide from the curve and its plan. A stated count wins outright.',
      }),
      numberField({
        id: 'workbench-copies',
        label: 'Max copies',
        value: draft.maxCopies,
        onChange: (value) => {
          set({ maxCopies: value });
        },
        issues,
        pointer: '/maxCopies',
        min: 1,
        max: 4,
        // What the field is, before what an unusual value of it does. It said
        // only "Set this to 1 for a singleton deck", which describes the corner
        // and never the ordinary case, and the playtester read "copies" as duplicate
        // cards she did not want and typed 1 — building a singleton deck she had
        // not asked for and did not recognize as one.
        hint: "How many of one card the deck may run. Four is Magic's ordinary limit; 1 makes it a singleton deck, one of each card.",
      }),
      numberField({
        id: 'workbench-max-mv',
        label: 'Mana value ceiling',
        value: draft.maxManaValue,
        onChange: (value) => {
          set({ maxManaValue: value });
        },
        issues,
        pointer: '/maxManaValue',
        min: 0,
        max: 20,
        hint: 'A ceiling on what may enter. The curve’s shape stays the model’s judgment.',
      }),
    ),

    textField({
      id: 'workbench-archetype',
      label: 'Archetype',
      value: draft.archetype,
      onChange: (value) => {
        set({ archetype: value });
      },
      issues,
      pointer: '/archetype',
      placeholder: 'aggro, control, reanimator',
      hint: 'Free text, not a menu: what an archetype is, is a judgment, and a fixed list would be this page making it.',
    }),

    textField({
      id: 'workbench-themes',
      label: 'Themes',
      value: draft.themes,
      onChange: (value) => {
        set({ themes: value });
      },
      issues,
      pointer: '/themes',
      placeholder: 'flyers, lifegain, artifacts',
      hint: 'Comma separated. Each one becomes a criterion a card can cite as its reason for being here.',
    }),

    textField({
      id: 'workbench-power',
      label: 'Power band',
      value: draft.powerBand,
      onChange: (value) => {
        set({ powerBand: value });
      },
      issues,
      pointer: '/powerBand',
      placeholder: 'casual kitchen-table',
    }),

    textField({
      id: 'workbench-opponents',
      label: 'Opponent population',
      value: draft.opponentPopulation,
      onChange: (value) => {
        set({ opponentPopulation: value });
      },
      issues,
      pointer: '/opponentPopulation',
      rows: 5,
      placeholder:
        '{"id":"local-field","members":[{"id":"pressure","share":1,"strategy":"curve out with creatures"}]}',
      hint: 'JSON with a stable field id and opponent members. Shares must sum to 1; each strategy is carried to the selector as written.',
    }),

    createElement(
      'div',
      { className: 'mtg-workbench__build' },
      textField({
        id: 'workbench-name',
        label: 'Call this variation',
        value: props.name,
        onChange: props.onNameChange,
        issues: [],
        pointer: '/name',
        placeholder: 'white weenie, 21 lands',
        ...(props.parentName === undefined
          ? {}
          : { hint: `A variation of “${props.parentName}”, kept beside it rather than replacing it.` }),
      }),
      props.canBuild
        ? createElement(
            'button',
            {
              type: 'submit',
              className: 'mtg-btn',
              'data-variant': 'primary',
              disabled: props.building,
            },
            props.building
              ? 'Building…'
              : props.parentName === undefined
                ? BUILD_BUTTON_LABEL
                : REBUILD_BUTTON_LABEL,
          )
        : createElement(
            'div',
            { className: 'mtg-workbench__unarmed' },
            createElement(
              'button',
              { type: 'button', className: 'mtg-btn', disabled: true },
              BUILD_BUTTON_LABEL,
            ),
            createElement('p', { className: 'mtg-workbench__hint' }, UNARMED_NOTE),
          ),
      ...(props.refusals ?? []).map((said, index) =>
        createElement('p', { key: `refusal-${String(index)}`, className: 'mtg-workbench__refusal' }, said),
      ),
    ),
  );
}
