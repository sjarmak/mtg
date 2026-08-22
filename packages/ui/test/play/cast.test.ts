// @vitest-environment jsdom
/**
 * Casting as a staged interaction (`mtg-bz2.3`).
 *
 * The bead's criterion has three clauses and each one is a describe below: the
 * stages are walked in order, every stage can be backed out of, and the spell
 * becomes a stack object only when the last press submits it. The third is the
 * one that fails quietly — a surface that put the spell on the stack at the
 * first click would look identical while the player was choosing, and would
 * differ only in a game the player then wanted to take back — so it is asserted
 * against the kernel's own stack and event log rather than against the panel.
 *
 * The position is stated rather than dealt, for the reason `click.test.ts`
 * states its own: two untapped Mountains pay for both red cards in hand, and the
 * one creature on the far side gives `Lightning Lash` — whose effect is
 * `anyTarget` — three legal aims and `Emberflow Raider` none. So one card in the
 * hand walks both stages and the other walks only the payment, off one board.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { Action, Choice, GameSession, GameState, ObjectId } from '@mtg/kernel';
import { botSeat, choose, humanSeat, pendingDecision, reduceAll, scenario, simpleAgent } from '@mtg/kernel';
import { CAST_CHOICE_STAGES, castPlansFor, castStage } from '../../src/routes/play/cast';
import type { CastPick, CastPlan, CastStep } from '../../src/routes/play/cast';
import { CAST_BACK_LABEL, castCancelLabel, castLabel, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { BOARD_CSS } from '../../src/styles/board';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0;

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const DRAKE = exampleCard('slc-windrider-drake');

/**
 * A modal spell (CR 700.2) whose two modes disagree about everything the panel
 * walks: one aims and one does not, so the mode question decides how many
 * questions follow it as well as what the spell does.
 *
 * Hand-written rather than taken from `exampleCard`, for `move-names.test.ts`'s
 * reason: the shipped example set prints no modal card, and a stage nothing in
 * the fixtures can enter is a stage nothing tests.
 */
const SPLIT: Card = parseCard({
  kind: 'instant',
  id: 'slc-split-decision',
  name: 'Split Decision',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 93 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  effects: [],
  modes: [
    { effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }] },
    { effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }] },
  ],
});

/**
 * A spell with an X in its cost, which is the one cast choice this surface
 * answers by declining to stage the cast at all.
 *
 * Announcing X is CR 601.2b like announcing a mode, but every value of X is a
 * different payment, and a plan carries one payment — so the panel hands the
 * card back to the flat menu, where the kernel's enumeration is already one row
 * per announced value. The fixture exists to hold that refusal to a position
 * where the kernel really did enumerate several casts.
 */
const GEYSER: Card = parseCard({
  kind: 'instant',
  id: 'slc-variable-geyser',
  name: 'Variable Geyser',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 94 },
  manaCost: { hasX: true, R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
});

/**
 * An Aura, which aims without printing a sentence to aim.
 *
 * The other half of the modal finding, and the reason the target walk counts
 * slots rather than sentences: `castOptions` reads the enchant restriction off
 * `card.aura` (`legal.ts`), so an Aura enumerates one cast per creature and an
 * empty effect list. A walk over the sentences would find none, take the first
 * enumerated cast, and attach the Aura to whichever creature that was.
 */
const CHAINS: Card = parseCard({
  kind: 'enchantment',
  id: 'slc-searing-chains',
  name: 'Searing Chains',
  rarity: 'common',
  set: { code: 'SLC', collectorNumber: 95 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'cantBlock' }] },
});

/** Two Mountains, one creature to shoot at, and both red cards in hand. */
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

/** The same board with a modal spell in hand instead of the two red cards. */
function modalSkirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[SPLIT], []],
  }).state;
}

/** The same board with two creatures to enchant and the Aura in hand. */
function auraSkirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: RAIDER, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[CHAINS], []],
  }).state;
}

/** The same board with the X spell in hand, so several values of X are legal. */
function xSkirmish(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[GEYSER], []],
  }).state;
}

/** The same board at cleanup one card over the limit, where a discard is owed. */
function overHandSize(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[RAIDER, LASH], []],
    maximumHandSize: 1,
    step: 'cleanup',
  }).state;
}

/** A session around a stated position; `PlayView` reads one and decides nothing. */
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

function handOid(state: GameState, name: string): ObjectId {
  const found = state.players[VIEWER].hand.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no ${name} in hand`);
  return found;
}

/** Whatever `getByRole` hands back, named without `lib: dom`; see `play.test.ts`. */
type Found = ReturnType<typeof screen.getByRole>;

function textOfNode(node: Found): string {
  return (node as unknown as { readonly textContent?: string | null }).textContent ?? '';
}

/** The staged-cast panel for one card, or null when none is open on it. */
function castGroup(cardName: string): Found | null {
  return screen.queryByRole('group', { name: castLabel(cardName) });
}

function openCast(cardName: string): Found {
  const group = castGroup(cardName);
  if (group === null) throw new Error(`no staged cast is open on ${cardName}`);
  return group;
}

/**
 * The buttons that answer the question on screen, which is every button in the
 * panel that is not one of the two ways out of it. On a target stage that is the
 * legal aims; on the payment stage it is the single press that casts.
 */
function castActions(cardName: string): readonly Found[] {
  const controls = new Set([CAST_BACK_LABEL, castCancelLabel(cardName)]);
  return within(openCast(cardName))
    .getAllByRole('button')
    .filter((button) => !controls.has(textOfNode(button)));
}

/** The step strip, in order, and which one the panel says is current. */
function castSteps(cardName: string): readonly string[] {
  return within(openCast(cardName))
    .getAllByRole('listitem')
    .map((item) => textOfNode(item));
}

function currentStep(cardName: string): string {
  const marked = within(openCast(cardName))
    .getAllByRole('listitem')
    .filter((item) => (item as unknown as { matches(s: string): boolean }).matches("[aria-current='step']"));
  return marked.map(textOfNode).join('|');
}

function press(list: readonly Found[], at: number, what: string): void {
  const target = list[at];
  if (target === undefined) throw new Error(`no ${what} to press`);
  fireEvent.click(target);
}

/** The hand card's own face, found by the object id its slot publishes. */
function clickCard(container: unknown, oid: ObjectId): void {
  const root = container as { querySelector(selector: string): unknown };
  const face = root.querySelector(`[data-permanent-key="${oid}"] button.mtg-card`) as
    Parameters<typeof fireEvent.click>[0] | null;
  if (face === null) throw new Error(`no pressable face for ${oid}`);
  fireEvent.click(face);
}

describe('a cast walks the stages in the order the rules put them in', () => {
  it('asks for the target first and the payment second, and submits neither on its own', () => {
    const session = seated(skirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(session.state, 'Lightning Lash'));

    // CR 601.2c before CR 601.2h, said on screen rather than only in control
    // flow: both steps are named, in order, and the first is the current one.
    expect(castSteps('Lightning Lash')).toEqual(['Targets', 'Payment']);
    expect(currentStep('Lightning Lash')).toBe('Targets');
    // `anyTarget` reaches both seats and every creature on the battlefield.
    // The near seat as the pronoun, beside the possessives: a target is said the
    // same way here as it is on the rail, where the phrase sits mid-label after
    // an arrow and a capital would read as a player called You (`mtg-crv`).
    expect(castActions('Lightning Lash').map(textOfNode)).toEqual(['you', 'Bot', "Bot's Windrider Drake"]);
    expect(onChoose).not.toHaveBeenCalled();

    press(castActions('Lightning Lash'), 2, 'the aim at the Drake');

    expect(currentStep('Lightning Lash')).toBe('Payment');
    expect(onChoose).not.toHaveBeenCalled();

    press(castActions('Lightning Lash'), 0, 'the cast');

    // And what it submits is the kernel's own index for that aiming, not a
    // constructed action: the surface never names a move the kernel did not.
    const wanted = session.pending?.options.findIndex(
      (option) =>
        option.type === 'castSpell' &&
        option.oid === handOid(session.state, 'Lightning Lash') &&
        option.targets[0]?.kind === 'permanent',
    );
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(wanted);
  });

  it("asks the mode first on a modal spell, in that mode's own printed words", () => {
    const session = seated(modalSkirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(session.state, 'Split Decision'));

    // CR 601.2b before CR 601.2c, and on screen for the same reason the other
    // two steps are named: the mode decides what the spell does and how many
    // questions are left, so a player pressing it has to see both.
    expect(castSteps('Split Decision')).toEqual(['Mode', 'Targets', 'Payment']);
    expect(currentStep('Split Decision')).toBe('Mode');
    // The card's own bullets. A modal card's `effects` is empty and what it
    // does lives in `modes`, so a panel reading the card's effect list would
    // draw two nameless buttons on a spell that appears to do nothing.
    expect(castActions('Split Decision').map(textOfNode)).toEqual([
      'Split Decision deals 2 damage to any target.',
      'You gain 3 life.',
    ]);
    expect(onChoose).not.toHaveBeenCalled();

    // The lifegain aims at nothing, so answering drops the target step rather
    // than asking a question the chosen mode does not have.
    press(castActions('Split Decision'), 1, 'the lifegain mode');

    expect(castSteps('Split Decision')).toEqual(['Mode', 'Payment']);
    expect(currentStep('Split Decision')).toBe('Payment');
    expect(onChoose).not.toHaveBeenCalled();

    press(castActions('Split Decision'), 0, 'the cast');

    const wanted = session.pending?.options.findIndex(
      (option) => option.type === 'castSpell' && option.mode === 1,
    );
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(wanted);
  });

  it('aims the mode it was given, in the sentences that mode prints', () => {
    const session = seated(modalSkirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(session.state, 'Split Decision'));
    press(castActions('Split Decision'), 0, 'the damage mode');

    expect(currentStep('Split Decision')).toBe('Targets');
    expect(
      within(openCast('Split Decision')).getByText('Split Decision deals 2 damage to any target.'),
    ).toBeDefined();
    expect(castActions('Split Decision').map(textOfNode)).toEqual(['you', 'Bot', "Bot's Windrider Drake"]);

    press(castActions('Split Decision'), 2, 'the aim at the Drake');

    const panel = openCast('Split Decision');
    expect(textOfNode(panel)).toContain(
      "Split Decision deals 2 damage to any target. → Bot's Windrider Drake",
    );
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('opens on the payment when the spell aims at nothing, and says so in the strip', () => {
    const session = seated(skirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(session.state, 'Emberflow Raider'));

    // One step, because there is no target question to answer. A strip that
    // listed a stage this spell never enters would be a strip that lied about
    // how far from committing the player is.
    expect(castSteps('Emberflow Raider')).toEqual(['Payment']);
    expect(onChoose).not.toHaveBeenCalled();

    press(castActions('Emberflow Raider'), 0, 'the cast');
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('draws the cost with the same pips the card face wears', () => {
    const session = seated(skirmish());
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));
    clickCard(view.container, handOid(session.state, 'Emberflow Raider'));

    // One registry for every mana symbol on this surface (`card/ManaPips.ts`),
    // which is also what spells the cost for a screen reader — so the panel says
    // `Pay` and the pips say the rest, rather than the two saying it twice.
    const panel = openCast('Emberflow Raider');
    expect(within(panel).getByRole('img', { name: 'Mana cost {1}{R}' })).toBeDefined();
    expect(textOfNode(panel)).toContain('Pay');
  });

  it('names the lands the payment will tap, and they are the lands it taps', () => {
    const state = skirmish();
    const session = seated(state);
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(state, 'Emberflow Raider'));
    const submit = castActions('Emberflow Raider')[0];
    if (submit === undefined) throw new Error('the payment stage drew no cast');
    // `{1}{R}` off two Mountains, so the line is not a tautology: it names two
    // sources by the name the table draws them under.
    expect(textOfNode(submit)).toContain('Taps Mountain, Mountain');

    // The claim under test is that the panel is reading the kernel rather than
    // guessing: `planPayment` is the same function `onCastSpell` calls, so the
    // named lands have to be the ones that come out of the reduction tapped.
    const plan = castPlansFor(state, session.pending as NonNullable<typeof session.pending>).get(
      handOid(state, 'Emberflow Raider'),
    );
    if (plan === undefined) throw new Error('no staged cast for the Raider');
    fireEvent.click(submit);
    const index: unknown = onChoose.mock.calls[0]?.[0];
    const action = session.pending?.options[index as number];
    if (action === undefined) throw new Error('the panel submitted no index');
    const after = reduceAll(state, [action]).state;
    const tapped = state.battlefield.filter((oid) => after.objects[oid]?.tapped === true);
    expect([...tapped].sort()).toEqual([...plan.taps.map((tap) => tap.oid)].sort());
    expect(plan.taps).toHaveLength(2);
  });
});

describe('every stage can be backed out of', () => {
  it('takes back the last answer without dropping the cast', () => {
    const session = seated(skirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    clickCard(view.container, handOid(session.state, 'Lightning Lash'));
    // Nothing to go back to at the first question, so the control is absent
    // rather than present and inert.
    expect(within(openCast('Lightning Lash')).queryByRole('button', { name: CAST_BACK_LABEL })).toBeNull();

    press(castActions('Lightning Lash'), 0, 'the aim at You');
    expect(currentStep('Lightning Lash')).toBe('Payment');

    fireEvent.click(within(openCast('Lightning Lash')).getByRole('button', { name: CAST_BACK_LABEL }));

    expect(currentStep('Lightning Lash')).toBe('Targets');
    // The near seat as the pronoun, beside the possessives: a target is said the
    // same way here as it is on the rail, where the phrase sits mid-label after
    // an arrow and a capital would read as a player called You (`mtg-crv`).
    expect(castActions('Lightning Lash').map(textOfNode)).toEqual(['you', 'Bot', "Bot's Windrider Drake"]);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('drops the whole cast on cancel, from the payment as well as the targets', () => {
    const session = seated(skirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    const lash = handOid(session.state, 'Lightning Lash');

    clickCard(view.container, lash);
    fireEvent.click(
      within(openCast('Lightning Lash')).getByRole('button', { name: castCancelLabel('Lightning Lash') }),
    );
    expect(castGroup('Lightning Lash')).toBeNull();

    clickCard(view.container, lash);
    press(castActions('Lightning Lash'), 1, 'the aim at the Bot');
    expect(currentStep('Lightning Lash')).toBe('Payment');
    fireEvent.click(
      within(openCast('Lightning Lash')).getByRole('button', { name: castCancelLabel('Lightning Lash') }),
    );

    expect(castGroup('Lightning Lash')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();

    // And the cast that follows starts clean rather than inheriting the aim the
    // canceled one had reached.
    clickCard(view.container, lash);
    expect(currentStep('Lightning Lash')).toBe('Targets');
  });

  it('cancels on a second click of the card and on Escape, which are the two reflexes', () => {
    const session = seated(skirmish());
    const onChoose = vi.fn();
    const view = render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));
    const lash = handOid(session.state, 'Lightning Lash');

    clickCard(view.container, lash);
    clickCard(view.container, lash);
    expect(castGroup('Lightning Lash')).toBeNull();

    clickCard(view.container, lash);
    const first = castActions('Lightning Lash')[0];
    if (first === undefined) throw new Error('the target stage drew no aims');
    fireEvent.keyDown(first, { key: 'Escape' });

    expect(castGroup('Lightning Lash')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('the spell reaches the stack only when the cast is submitted', () => {
  it('leaves the stack empty and the log silent until the last press', () => {
    let session = seated(skirmish());
    const view = render(
      h(PlayView, {
        session,
        viewer: VIEWER,
        names: NAMES,
        onChoose: (choice: Choice): void => {
          session = choose(session, choice);
        },
      }),
    );
    clickCard(view.container, handOid(session.state, 'Lightning Lash'));

    press(castActions('Lightning Lash'), 2, 'the aim at the Drake');
    // Halfway through: aimed, priced, and still not cast. The panel is the only
    // thing that has changed — the kernel has not been asked anything.
    expect(currentStep('Lightning Lash')).toBe('Payment');
    expect(session.state.stack).toHaveLength(0);
    expect(session.events.filter((event) => event.type === 'spellCast')).toHaveLength(0);
    expect(session.decisions).toBe(0);

    press(castActions('Lightning Lash'), 0, 'the cast');

    expect(session.decisions).toBe(1);
    expect(session.events.filter((event) => event.type === 'spellCast')).toHaveLength(1);
    expect(session.state.stack.map((entry) => entry.oid)).toEqual([
      handOid(seated(skirmish()).state, 'Lightning Lash'),
    ]);
  });
});

describe('the plan is the kernel enumeration read one slot at a time', () => {
  function plansOf(state: GameState): ReadonlyMap<ObjectId, CastPlan> {
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('nobody is being asked');
    return castPlansFor(state, decision);
  }

  it('offers a staged cast for exactly the cards the kernel enumerated a cast for', () => {
    const state = skirmish();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('nobody is being asked');
    const enumerated = new Set(
      decision.options.flatMap((option: Action) => (option.type === 'castSpell' ? [option.oid] : [])),
    );
    expect([...plansOf(state).keys()].sort()).toEqual([...enumerated].sort());
    expect(enumerated.size).toBe(2);
  });

  it('offers none at a decision that is not a priority, so a discard is not a cast', () => {
    expect(plansOf(overHandSize()).size).toBe(0);
  });

  it('settles a slot with one candidate rather than asking a question with one answer', () => {
    const state = skirmish();
    const plan = plansOf(state).get(handOid(state, 'Emberflow Raider'));
    if (plan === undefined) throw new Error('no staged cast for the Raider');
    // One enumerated option and one effect-less card: nothing to ask, so the
    // first stage is already the payment.
    expect(plan.options).toHaveLength(1);
    expect(castStage(state, NAMES, plan, [])?.kind).toBe('pay');
  });

  it('lists a target once however many enumerated casts reach it', () => {
    const state = skirmish();
    const plan = plansOf(state).get(handOid(state, 'Lightning Lash'));
    if (plan === undefined) throw new Error('no staged cast for the Lash');
    const stage = castStage(state, NAMES, plan, []);
    if (stage?.kind !== 'targets') throw new Error('the Lash should be asking for a target');
    expect(stage.candidates).toHaveLength(plan.options.length);
    expect(stage.ask).toBe('Lightning Lash deals 3 damage to any target.');
  });

  it('asks which mode before it names a cast, because the mode is what a cast is', () => {
    const state = modalSkirmish();
    const plan = plansOf(state).get(handOid(state, 'Split Decision'));
    if (plan === undefined) throw new Error('no staged cast for Split Decision');
    // Four enumerated casts: three aims for the damage mode, and the lifegain,
    // which aims at nothing. A first stage that already named one of them would
    // be the surface choosing a mode the player never saw (CR 601.2b).
    expect(plan.options).toHaveLength(4);
    expect(castStage(state, NAMES, plan, [])?.kind).toBe('mode');
  });

  it('asks an Aura where it goes, though it prints no sentence to put beside the question', () => {
    const state = auraSkirmish();
    const plan = plansOf(state).get(handOid(state, 'Searing Chains'));
    if (plan === undefined) throw new Error('no staged cast for Searing Chains');
    expect(plan.options).toHaveLength(2);
    const stage = castStage(state, NAMES, plan, []);
    if (stage?.kind !== 'targets') throw new Error('the Aura should be asking which creature it enchants');
    expect(stage.candidates.map((candidate) => candidate.label).sort()).toEqual([
      "Bot's Windrider Drake",
      'your Emberflow Raider',
    ]);
    // The card's own name is the fallback ask, because there is no sentence to
    // print above the buttons and "which creature" is still the question.
    expect(stage.ask).toBe('Searing Chains');
  });

  it('closes rather than drawing a stage when the answers name no enumerated cast', () => {
    const state = skirmish();
    const plan = plansOf(state).get(handOid(state, 'Lightning Lash'));
    if (plan === undefined) throw new Error('no staged cast for the Lash');
    // A panel is scoped to a decision count, which is a counter rather than an
    // identity, so picks taken against one position can arrive at another.
    const stale: readonly CastPick[] = [
      { kind: 'target', slot: 0, target: { kind: 'permanent', oid: 'nowhere' } },
    ];
    expect(castStage(state, NAMES, plan, stale)).toBeNull();
  });
});

/**
 * The one thing about the panel's box that is not geometry.
 *
 * Where it sits was measured in a browser and written into
 * `styles/board/cast.ts`, because jsdom lays nothing out. What a test here *can*
 * hold is the premise that measurement rests on: the block borrows
 * `.mtg-picker`'s box rather than declaring one, so the numbers `picker.ts`
 * measured are still the numbers in force. A `position` or a `width` added to
 * `.mtg-cast` would silently move the panel out from under both files' comments.
 */
describe('the panel borrows the picker box rather than declaring its own', () => {
  const block = /\n\.mtg-cast[^{]*\{[^}]*\}/g;

  it('declares no placement of its own anywhere in the block', () => {
    const rules = BOARD_CSS.match(block) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const property of ['position:', 'width:', 'inset-', 'z-index:', 'max-height:']) {
        expect(rule).not.toContain(property);
      }
    }
  });

  it('sits after the picker in the cascade, which is what lets it tie and win', () => {
    expect(BOARD_CSS.indexOf('.mtg-cast__steps')).toBeGreaterThan(BOARD_CSS.indexOf('.mtg-picker {'));
  });
});

/**
 * Every choice a cast announces is a choice this surface asks about.
 *
 * The pin this replaces was not one. It read the keys off a `castSpell` action
 * taken from a position holding no modal card and no X, and asserted they were
 * `oid`, `player`, `targets`, `type` — which is what an action with two absent
 * optional fields prints whether or not the panel can walk them. `modes`
 * arrived (CR 700.2, `mtg-bc2.152.5`), the panel went on casting whichever mode
 * the kernel enumerated first, and the pin stayed green; so did the paragraph
 * in `cast.ts` that the pin was there to invalidate. A gate that cannot be made
 * to fail is not a gate.
 *
 * What is checked here is the property instead, in two halves that fail for
 * different reasons. `CAST_CHOICE_STAGES` is total over the action's own
 * choices, so a fourth one cannot be added to `@mtg/kernel` without `cast.ts`
 * failing to compile — that half is the type checker's and is deliberately not
 * restated here as a literal. The half a test can hold is what that constant
 * *produces*: every stage it names is a stage the panel actually reaches, and
 * every cast the kernel enumerated is a cast the questions can be walked to.
 * A choice the panel skips makes some enumerated cast unreachable, which is
 * exactly what a silently-announced mode is.
 */
describe('every choice a cast announces is a choice this surface asks about', () => {
  /** What one card's panel can be walked to, by answering every question every way. */
  interface Walk {
    /** The `decision.options` indices the payment stage is ever willing to submit. */
    readonly casts: ReadonlySet<number>;
    /** The stages that walk passed through. */
    readonly stages: ReadonlySet<CastStep>;
  }

  function walkEveryAnswer(state: GameState, plan: CastPlan): Walk {
    const casts = new Set<number>();
    const stages = new Set<CastStep>();
    const walk = (picks: readonly CastPick[]): void => {
      const stage = castStage(state, NAMES, plan, picks);
      if (stage === null) return;
      stages.add(stage.kind);
      switch (stage.kind) {
        case 'mode':
          for (const choice of stage.choices) walk([...picks, { kind: 'mode', mode: choice.mode }]);
          return;
        case 'targets':
          for (const candidate of stage.candidates) {
            walk([...picks, { kind: 'target', slot: stage.slot, target: candidate.target }]);
          }
          return;
        case 'pay':
          casts.add(stage.option.index);
      }
    };
    walk([]);
    return { casts, stages };
  }

  function walkEveryPlan(state: GameState): Walk {
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('nobody is being asked');
    const plans = [...castPlansFor(state, decision).values()];
    if (plans.length === 0) throw new Error('the position staged no cast at all');
    const casts = new Set<number>();
    const stages = new Set<CastStep>();
    for (const plan of plans) {
      const walk = walkEveryAnswer(state, plan);
      // Named per plan rather than pooled at the end: a card whose casts are
      // unreachable is a card, and a pooled count could be made whole by
      // another card's options.
      expect([...walk.casts].sort()).toEqual([...plan.options.map((option) => option.index)].sort());
      for (const index of walk.casts) casts.add(index);
      for (const kind of walk.stages) stages.add(kind);
    }
    return { casts, stages };
  }

  it('walks to every cast the kernel enumerated, and to nothing else', () => {
    // Both positions, because the modal card is the one that has a mode to
    // announce and the plain one is the one that proves the walk is not
    // reaching four casts by accident.
    for (const state of [skirmish(), modalSkirmish()]) {
      const decision = pendingDecision(state);
      if (decision === null) throw new Error('nobody is being asked');
      const enumerated = decision.options.flatMap((option: Action, index: number) =>
        option.type === 'castSpell' ? [index] : [],
      );
      expect([...walkEveryPlan(state).casts].sort()).toEqual([...enumerated].sort());
    }
  });

  it('reaches every stage the choice map names, so a named stage is not a dead branch', () => {
    const reached = new Set([...walkEveryPlan(skirmish()).stages, ...walkEveryPlan(modalSkirmish()).stages]);
    for (const [choice, stage] of Object.entries(CAST_CHOICE_STAGES)) {
      if (stage === null) continue;
      expect(reached, `${choice} claims the ${stage} stage`).toContain(stage);
    }
  });

  it('stages no cast at all for the one choice the map leaves unasked', () => {
    // `x` is the `null` row: the cost is not settled until the value is
    // announced, so the card is left to the flat menu rather than staged with
    // a payment line that names the lands X=0 would tap. The kernel offers
    // several casts of it; the panel offers none of them.
    const state = xSkirmish();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('nobody is being asked');
    const geyser = handOid(state, 'Variable Geyser');
    const enumerated = decision.options.filter(
      (option: Action) => option.type === 'castSpell' && option.oid === geyser,
    );
    expect(enumerated.length).toBeGreaterThan(1);
    expect(castPlansFor(state, decision).has(geyser)).toBe(false);
  });
});
