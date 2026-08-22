// @vitest-environment jsdom
/**
 * Choosing a target on the battlefield (`mtg-bz2.6`).
 *
 * The bead has three clauses and each one is a describe below: a spell that
 * needs a target puts the surface in a targeting state, the legal targets are
 * lit and the illegal ones are visibly inert, and no target choice can produce a
 * post-hoc error.
 *
 * The third clause was already true before this lane and the tests here say so
 * rather than claiming credit: every candidate the board offers came out of
 * `Decision.options`, so what is asserted is that the *board* cannot widen that
 * set — a card the enumeration never named has no pressable face at all, which
 * makes the error impossible rather than caught. The clause that needed building
 * is the second one, and it is asserted twice from opposite sides: which faces
 * are pressable while a slot is open, and which are pressable again the moment
 * it closes. A rule that dimmed the table and forgot to undim it would pass the
 * first assertion alone.
 *
 * The board's paint is not here. jsdom performs no layout and its cascade is a
 * weak instrument for a rule three combinators deep, so what the dim actually
 * looks like is measured in a browser by `./aim-dim.browser.test.ts`. This file
 * asks only what the DOM says, which is where the legality lives.
 *
 * The position is `./cast.test.ts`'s and for its reason: two untapped Mountains
 * pay for both red cards in hand, and the one creature across the table gives
 * `Lightning Lash` — whose effect is `anyTarget` — three legal aims, of which
 * exactly one is a permanent. That last fact is what makes the board and the
 * panel disagree in an interesting way: the panel lists three answers and the
 * table can draw one of them, so a test that found the table lighting three
 * would have caught a board inventing aims.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import type { CastTargetStage } from '../../src/routes/play/cast';
import { CAST_BACK_LABEL, castCancelLabel, castLabel, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { aimableTargets, NO_TARGET_GESTURE, targetGesture } from '../../src/routes/play/targeting';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const DRAKE = exampleCard('slc-windrider-drake');

function skirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[RAIDER, LASH], []],
  }).state;
}

/**
 * The same position with a body on the viewer's own side.
 *
 * `anyTarget` reaches either creature, so the spell has two aims a card on the
 * table can carry rather than one. That is the only position in which "the card
 * that was pressed" and "the first card the slot named" are different answers,
 * and a board that confused them reads identically to a correct one on
 * `skirmish`.
 */
function crossfire(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: RAIDER, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[LASH], []],
  }).state;
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), botSeat(simpleAgent('Bot'))],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** Every object of one name the viewer holds or controls, in the order it was stated. */
function oidsOf(state: GameState, name: string): readonly ObjectId[] {
  return Object.keys(state.objects).filter((oid) => state.objects[oid]?.card.name === name);
}

function oneOf(state: GameState, name: string): ObjectId {
  const found = oidsOf(state, name)[0];
  if (found === undefined) throw new Error(`no ${name} in this position`);
  return found;
}

/**
 * The narrow shape these tests reach the rendered tree through, for the reason
 * `../board.test.ts` states one: the workspace tsconfig has no `lib: dom`, so
 * what testing-library hands back carries none of these members at compile time.
 */
interface QueryLike {
  readonly querySelector: (selector: string) => unknown;
  readonly querySelectorAll: (selector: string) => Iterable<unknown>;
}

function asQuery(value: unknown): QueryLike {
  const candidate = value as Partial<QueryLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.querySelectorAll !== 'function'
  ) {
    throw new Error('expected a rendered tree');
  }
  return candidate as QueryLike;
}

/** What the mat says about the targeting state, which is what the sheet selects on. */
function aiming(container: unknown): string | null {
  const board = asQuery(container).querySelector('.mtg-board') as {
    getAttribute(name: string): string | null;
  } | null;
  if (board === null) throw new Error('no board is drawn');
  return board.getAttribute('data-aiming');
}

/** The card face for one object, or null when the surface drew it inert. */
function faceOf(container: unknown, oid: ObjectId): unknown {
  return asQuery(container).querySelector(`[data-permanent-key="${oid}"] button.mtg-card`);
}

/** Whether the object is on screen at all, drawn or inert; the bead forbids hiding. */
function slotOf(container: unknown, oid: ObjectId): unknown {
  return asQuery(container).querySelector(`[data-permanent-key="${oid}"]`);
}

/** Every object on the table whose face is a control right now, sorted for comparison. */
function pressableKeys(container: unknown): readonly string[] {
  const slots = [...asQuery(container).querySelectorAll('[data-permanent-key]')];
  return slots
    .filter((slot) => asQuery(slot).querySelector('button.mtg-card') !== null)
    .map(
      (slot) =>
        (slot as { getAttribute(name: string): string | null }).getAttribute('data-permanent-key') ?? '',
    )
    .sort();
}

function clickCard(container: unknown, oid: ObjectId): void {
  const face = faceOf(container, oid) as Parameters<typeof fireEvent.click>[0] | null;
  if (face === null) throw new Error(`no pressable face for ${oid}`);
  fireEvent.click(face);
}

type Found = ReturnType<typeof screen.getByRole>;

function textOfNode(node: Found): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

function openCast(cardName: string): Found {
  const group = screen.queryByRole('group', { name: castLabel(cardName) });
  if (group === null) throw new Error(`no staged cast is open on ${cardName}`);
  return group;
}

/** The panel's own answers to the open question: every button that is not a way out. */
function panelAnswers(cardName: string): readonly string[] {
  const controls = new Set([CAST_BACK_LABEL, castCancelLabel(cardName)]);
  return within(openCast(cardName))
    .getAllByRole('button')
    .map((button) => textOfNode(button))
    .filter((label) => !controls.has(label));
}

/** Press the panel's one remaining answer, which at the payment is the cast itself. */
function submitCast(cardName: string): void {
  const controls = new Set([CAST_BACK_LABEL, castCancelLabel(cardName)]);
  const action = within(openCast(cardName))
    .getAllByRole('button')
    .find((button) => !controls.has(textOfNode(button)));
  if (action === undefined) throw new Error(`no cast to press on ${cardName}`);
  fireEvent.click(action as Parameters<typeof fireEvent.click>[0]);
}

function currentStep(cardName: string): string {
  return within(openCast(cardName))
    .getAllByRole('listitem')
    .filter((item) => (item as unknown as { matches(s: string): boolean }).matches("[aria-current='step']"))
    .map((item) => textOfNode(item))
    .join('|');
}

function played(
  state: GameState,
  onChoose = vi.fn(),
): {
  readonly container: unknown;
  readonly state: GameState;
  readonly onChoose: ReturnType<typeof vi.fn>;
} {
  const session = seated(state);
  const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
  return { container: view.container, state: session.state, onChoose };
}

describe('a spell that needs a target puts the table in a targeting state', () => {
  it('says so on the mat, and says the opposite when nothing is being aimed', () => {
    const table = played(skirmish());

    // The resting state is the claim that matters most here: a surface that
    // reported a targeting state whenever a cast panel was open would dim the
    // table through the payment as well, and every assertion below would still
    // pass.
    expect(aiming(table.container)).toBe('false');

    clickCard(table.container, oneOf(table.state, LASH.name));
    expect(aiming(table.container)).toBe('true');

    clickCard(table.container, oneOf(table.state, DRAKE.name));
    // The slot is answered, so the question is the payment and the table is a
    // table again.
    expect(currentStep(LASH.name)).toBe('Payment');
    expect(aiming(table.container)).toBe('false');
  });

  it('lights the legal targets and nothing else, on both sides of the table', () => {
    const table = played(skirmish());
    const lash = oneOf(table.state, LASH.name);
    const drake = oneOf(table.state, DRAKE.name);

    const atRest = pressableKeys(table.container);
    // The board this is measured against has to have something else on it to
    // put out, or the assertion below is satisfied by an empty table.
    expect(atRest.length).toBeGreaterThan(2);

    clickCard(table.container, lash);

    // The Drake because the spell can be aimed at it, the Lash because clicking
    // the card whose panel is open is the way back out. Nothing else: not the
    // Mountains that could otherwise be tapped, not the other card in hand.
    expect(pressableKeys(table.container)).toEqual([drake, lash].sort());
  });

  it('gives the table back the moment the question is answered', () => {
    const table = played(skirmish());
    const atRest = pressableKeys(table.container);

    clickCard(table.container, oneOf(table.state, LASH.name));
    clickCard(table.container, oneOf(table.state, DRAKE.name));

    expect(pressableKeys(table.container)).toEqual(atRest);
  });
});

describe('an illegal object is visibly inert rather than hidden', () => {
  it('leaves the card on the table with no control on it', () => {
    const table = played(skirmish());
    const mountain = oneOf(table.state, MOUNTAIN.name);

    clickCard(table.container, oneOf(table.state, LASH.name));

    // Both halves, because either one alone is a different surface: a face with
    // no button is inert, and a slot still in the document is the card not
    // having been hidden. `mtg-bz2.6` asks for exactly this pair — "rather than
    // hiding unavailable commands, the interface clearly distinguishes currently
    // legal cards and actions from inactive ones".
    expect(faceOf(table.container, mountain)).toBeNull();
    expect(slotOf(table.container, mountain)).not.toBeNull();
  });

  it('keeps every candidate in the panel, including the ones no card can carry', () => {
    const table = played(skirmish());

    clickCard(table.container, oneOf(table.state, LASH.name));

    // `anyTarget` reaches both players and the creature. The board can only draw
    // the creature — a seat's pod is a vitals block, not an object — so the panel
    // is still the complete list and the board is an added door to it. A lane
    // that had moved the question to the table would show one answer here.
    expect(panelAnswers(LASH.name)).toEqual(['you', 'Bot', `Bot's ${DRAKE.name}`]);
  });
});

describe('no target choice can produce a post-hoc error', () => {
  it('attaches the target to the spell and submits nothing on its own', () => {
    const table = played(skirmish());

    clickCard(table.container, oneOf(table.state, LASH.name));
    expect(currentStep(LASH.name)).toBe('Targets');

    clickCard(table.container, oneOf(table.state, DRAKE.name));

    // The aim is on the spell and the panel has moved on, and the kernel has
    // been told nothing: a staged cast reaches it once, at the payment.
    expect(currentStep(LASH.name)).toBe('Payment');
    expect(textOfNode(openCast(LASH.name))).toContain(`Bot's ${DRAKE.name}`);
    expect(table.onChoose).not.toHaveBeenCalled();
  });

  it('aims at the card that was pressed, not at the first one the slot offered', () => {
    // Both arms of the loop, because one alone is passed by a board that sends
    // the slot's first candidate whatever was pressed: the position has two
    // permanents the spell may be aimed at, and only pressing each in turn and
    // reading back which one the kernel was told about separates the two.
    for (const name of [DRAKE.name, RAIDER.name]) {
      const session = seated(crossfire());
      const onChoose = vi.fn();
      const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
      const wanted = oneOf(session.state, name);

      clickCard(view.container, oneOf(session.state, LASH.name));
      const lit = pressableKeys(view.container);
      expect(lit).toContain(oneOf(session.state, DRAKE.name));
      expect(lit).toContain(oneOf(session.state, RAIDER.name));

      clickCard(view.container, wanted);
      submitCast(LASH.name);

      // Read back through the kernel's own option list rather than through the
      // panel's prose: the assertion is about which move was submitted, and the
      // sentence a surface prints beside it is a different claim.
      const index: unknown = onChoose.mock.calls[0]?.[0];
      const action = session.pending?.options[index as number];
      if (action === undefined || action.type !== 'castSpell') {
        throw new Error(`the panel submitted no cast when ${name} was pressed`);
      }
      expect(action.targets[0]).toEqual({ kind: 'permanent', oid: wanted });
      cleanup();
    }
  });

  it('offers no aim the enumeration did not name', () => {
    const table = played(skirmish());
    const lash = oneOf(table.state, LASH.name);

    clickCard(table.container, lash);

    // Every pressable key is either an answer the panel is also offering or the
    // spell itself. There is no third category, which is what makes an illegal
    // aim unreachable rather than rejected.
    const answers = panelAnswers(LASH.name);
    for (const key of pressableKeys(table.container)) {
      if (key === lash) continue;
      const label = (
        asQuery(table.container).querySelector(`[data-permanent-key="${key}"] .mtg-card__name`) as {
          textContent?: string | null;
        } | null
      )?.textContent;
      expect(answers.some((answer) => label !== null && label !== undefined && answer.includes(label))).toBe(
        true,
      );
    }
  });
});

describe('the gesture is derived from the open slot and holds nothing of its own', () => {
  /** A slot offering one of each target shape, so the filter has all three to sort. */
  const stage: CastTargetStage = {
    kind: 'targets',
    steps: ['targets', 'pay'],
    slot: 0,
    ask: 'Deals damage to any target.',
    candidates: [
      { target: { kind: 'player', player: 1 }, label: 'the other seat' },
      { target: { kind: 'permanent', oid: 'o7' }, label: 'a creature' },
      { target: { kind: 'spell', oid: 'o9' }, label: 'a spell on the stack' },
      { target: null, label: 'no target' },
    ],
  };

  it('keeps only the aims a card on the battlefield can carry', () => {
    // Named one at a time rather than by count, because the count is satisfied
    // by keeping the wrong one.
    expect([...aimableTargets(stage).keys()]).toEqual(['o7']);
    expect(aimableTargets(stage).get('o7')).toEqual({ kind: 'permanent', oid: 'o7' });
  });

  it('carries the aim itself rather than a rebuilt copy of it', () => {
    const aim = aimableTargets(stage).get('o7');
    expect(aim).toBe(stage.candidates[1]?.target);
  });

  it('lights nothing at all when no slot is open', () => {
    expect(targetGesture(null)).toEqual(NO_TARGET_GESTURE);
    expect(targetGesture(null).source).toBeNull();
    expect(targetGesture(null).answers.size).toBe(0);
  });

  it('names the spell doing the aiming, so the table knows what it is drawing quiet for', () => {
    const gesture = targetGesture({ oid: 'o1', stage });
    expect(gesture.source).toBe('o1');
    expect([...gesture.answers]).toEqual(['o7']);
  });
});
