/**
 * The staged cast, drawn where the picker is drawn.
 *
 * It reuses `.mtg-picker`'s box outright — the placement, the width, the fixed
 * positioning that a scrolling zone body cannot clip, and the `data-picking`
 * mark on the slot it hangs off — because all of that was measured for exactly
 * this job (`styles/board/picker.ts` carries the numbers) and a second box in a
 * second corner would be a second set of measurements to keep true. What this
 * file adds is the inside: which step the player is on, what that step is
 * asking, and the two ways out of it.
 *
 * **Every step names itself and the steps around it.** The head is an ordered
 * list of the stages this cast has, with the current one marked `aria-current`,
 * because a player who is being asked one question at a time has to be able to
 * see that there is another one coming and that it is not the last chance to
 * stop. It is also what makes "walks the stages in order" a thing a test can
 * read rather than a claim about control flow.
 *
 * **Back and Cancel are both offered, and they are not the same control.** Back
 * returns to the previous question and keeps everything answered before it;
 * Cancel drops the whole cast. Neither one has touched the kernel — a staged
 * cast is interaction state that has never left this surface, so there is
 * nothing to take back and no commit boundary to check. `selection.ts` carries
 * that distinction at more length, and `mtg-bz2.15`'s undo control is the other
 * mechanism entirely: it rewinds decisions the kernel has already applied.
 *
 * The one button here that submits anything is `choice-button.ts`'s, carrying
 * the index of the single enumerated cast the answers leave standing. A rail
 * press and the last press of this panel are therefore the same button
 * dispatching the same integer, which is what keeps a game played through the
 * panel replayable on the recording alone.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ManaPips } from '../../card/ManaPips';
import { choiceButton, choiceLabel } from './choice-button';
import type { CastPick, CastPlan, CastStage, CastStep } from './cast';
import type { PlayChoice } from './prompt';

/** The accessible name of the panel holding a cast in progress. */
export function castLabel(cardName: string): string {
  return `Casting ${cardName}`;
}

/** The control that takes back the last answer without dropping the cast. */
export const CAST_BACK_LABEL = 'Back a step';

/** The control that drops the cast entirely, named so it says what it drops. */
export function castCancelLabel(cardName: string): string {
  return `Cancel casting ${cardName}`;
}

/**
 * What each stage is called on screen.
 *
 * The words live here and which stages a cast has lives in `cast.ts`, which is
 * the same split every other panel on this surface keeps: a stage nobody can
 * enter is a question about the rules, and what to call one is a question about
 * the strip. Keyed by `CastStep`, so a fourth stage cannot be drawn nameless.
 */
const STEP_NAMES: Readonly<Record<CastStep, string>> = {
  mode: 'Mode',
  targets: 'Targets',
  pay: 'Payment',
};

/**
 * What the payment will actually do, in one line.
 *
 * The taps come from the kernel's own plan for this cost in this position, so
 * the lands named here are the lands `onCastSpell` turns sideways.
 *
 * The empty case says what it can prove rather than guessing why. An empty plan
 * means the mana is already there — from a land tapped by hand, or from a cost
 * of nothing at all — and this panel is not carrying the pool, so it states the
 * fact it has: no land is about to turn. Naming the pool would be a sentence
 * that is false on a free spell.
 */
function paymentLine(plan: CastPlan): string {
  if (plan.taps.length === 0) return 'No land needs tapping';
  return `Taps ${plan.taps.map((tap) => tap.name).join(', ')}`;
}

function stepList(stage: CastStage): ReactElement {
  const names = stage.steps.map((step) => STEP_NAMES[step]);
  const current = STEP_NAMES[stage.kind];
  return createElement(
    'ol',
    // The role is stated because the sheet takes the markers off, and a list
    // with `list-style: none` loses its list semantics in WebKit — the steps
    // would stop being announced as one ordered set, which is the whole of what
    // this strip is for.
    { className: 'mtg-cast__steps', role: 'list' },
    ...names.map((name) =>
      createElement(
        'li',
        {
          key: name,
          className: 'mtg-cast__step',
          ...(name === current ? { 'aria-current': 'step' as const } : {}),
        },
        name,
      ),
    ),
  );
}

/** One answer on offer: what the button reads, and what pressing it records. */
interface CastAnswer {
  readonly label: string;
  readonly pick: CastPick;
}

/**
 * A question and the answers to it, which is the shape of both stages that ask
 * one. Shared rather than written twice because the focus rule below is one
 * rule: a mode question and a target question are the same question to a
 * keyboard, and two copies of it could come apart.
 */
function askBody(ask: string, answers: readonly CastAnswer[], onPick: (pick: CastPick) => void): ReactNode {
  return createElement(
    Fragment,
    null,
    createElement('p', { className: 'mtg-cast__ask' }, ask),
    createElement(
      'div',
      { className: 'mtg-picker__list' },
      ...answers.map((answer, at) =>
        createElement(
          'button',
          {
            key: answer.label,
            type: 'button',
            className: 'mtg-choice',
            // The first candidate takes the ring for the reason the picker's
            // first option does: a panel that opens behind the keyboard is a
            // panel the keyboard has to go looking for.
            ...(at === 0 ? { autoFocus: true } : {}),
            onClick: () => {
              onPick(answer.pick);
            },
          },
          choiceLabel(answer.label),
        ),
      ),
    ),
  );
}

function targetsBody(
  stage: Extract<CastStage, { kind: 'targets' }>,
  onPick: (pick: CastPick) => void,
): ReactNode {
  const answers = stage.candidates.map((candidate): CastAnswer => ({
    label: candidate.label,
    pick: { kind: 'target', slot: stage.slot, target: candidate.target },
  }));
  return askBody(stage.ask, answers, onPick);
}

function modeBody(stage: Extract<CastStage, { kind: 'mode' }>, onPick: (pick: CastPick) => void): ReactNode {
  const answers = stage.choices.map((choice): CastAnswer => ({
    label: choice.label,
    pick: { kind: 'mode', mode: choice.mode },
  }));
  return askBody(stage.ask, answers, onPick);
}

function payBody(
  plan: CastPlan,
  stage: Extract<CastStage, { kind: 'pay' }>,
  onChoose: (index: number) => void,
): ReactNode {
  // The finished move, wearing the panel's own words. The aims are already
  // listed above it as their own lines, so the button says what pressing it
  // does and the detail says what it spends.
  const submit: PlayChoice = {
    index: stage.option.index,
    label: `Cast ${plan.cardName}`,
    detail: paymentLine(plan),
    kind: 'castSpell',
    oids: [plan.oid],
  };
  return createElement(
    Fragment,
    null,
    createElement(
      'p',
      { className: 'mtg-cast__ask' },
      // The verb, then the cost as the card face draws it. Spelling the cost out
      // beside the pips would say it twice to a screen reader: `ManaPips` names
      // itself `Mana cost {1}{R}`, which is the same sentence.
      createElement('span', { className: 'mtg-cast__cost' }, 'Pay'),
      createElement(ManaPips, { cost: plan.manaCost }),
    ),
    stage.aims.length === 0
      ? null
      : createElement(
          'ul',
          { className: 'mtg-cast__aims', role: 'list' },
          ...stage.aims.map((aim) => createElement('li', { key: aim, className: 'mtg-cast__aim' }, aim)),
        ),
    createElement('div', { className: 'mtg-picker__list' }, choiceButton(submit, onChoose, true)),
  );
}

/** The body of whichever stage is open; exhaustive over `CastStage`. */
function stageBody(
  plan: CastPlan,
  stage: CastStage,
  onPick: (pick: CastPick) => void,
  onChoose: (index: number) => void,
): ReactNode {
  switch (stage.kind) {
    case 'mode':
      return modeBody(stage, onPick);
    case 'targets':
      return targetsBody(stage, onPick);
    case 'pay':
      return payBody(plan, stage, onChoose);
  }
}

export interface CastPanelInput {
  readonly plan: CastPlan;
  readonly stage: CastStage;
  /** Answers the question on screen and moves to the next one. */
  readonly onPick: (pick: CastPick) => void;
  /** Takes back the last answer, or null at the first question. */
  readonly onBack: (() => void) | null;
  /** Drops the whole cast; nothing has reached the kernel. */
  readonly onCancel: () => void;
  /** Submits the finished cast by its index in the pending enumeration. */
  readonly onChoose: (index: number) => void;
}

export function castPanel(input: CastPanelInput): ReactElement {
  const { plan, stage, onPick, onBack, onCancel, onChoose } = input;
  return createElement(
    'div',
    {
      className: 'mtg-picker mtg-cast',
      role: 'group',
      'aria-label': castLabel(plan.cardName),
    },
    createElement('span', { className: 'mtg-picker__title' }, plan.cardName),
    stepList(stage),
    stageBody(plan, stage, onPick, onChoose),
    createElement(
      'div',
      { className: 'mtg-cast__controls' },
      onBack === null
        ? null
        : createElement('button', { type: 'button', className: 'mtg-btn', onClick: onBack }, CAST_BACK_LABEL),
      createElement(
        'button',
        { type: 'button', className: 'mtg-btn', onClick: onCancel },
        castCancelLabel(plan.cardName),
      ),
    ),
  );
}
