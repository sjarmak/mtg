// @vitest-environment jsdom
/**
 * No two legal moves may read the same.
 *
 * `mtg-cee`. The rail is the complete enumeration and every entry submits its
 * own index, which is worth nothing if two entries carry the same words: a board
 * with one Emberflow Raider a side offered two casts of Lightning Lash whose
 * visible text and accessible name were both `Cast Lightning Lash → Emberflow
 * Raider`, one burning the opponent's creature and one burning yours. The pods
 * did not separate them either, because both faces sit in different rows of the
 * same battlefield.
 *
 * `src/routes/play/naming.ts` holds the rule and its reasoning. This file holds
 * the property the rule exists for, stated over the board the bug was measured
 * on, plus the two cases the rule answers differently on purpose:
 *
 *  - two permanents the possessive can separate (one a side) — always separated,
 *  - two the possessive cannot (both yours) — separated by what the board shows,
 *  - two the board shows nothing between — left reading alike, because that is
 *    the true statement about them and the choice is genuinely free.
 *
 * The stack zone and the staged cast panel print targets through the same
 * function, so they are checked here too. Three surfaces naming one permanent
 * three ways would be the failure `prompt.ts` and `choice-button.ts` both name.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AbilityInput, Card } from '@mtg/dsl';
import { effectsFor, exampleCard, parseCard, renderEffect } from '@mtg/dsl';
import type { Action, Decision, GameSession, GameState, ObjectId, Target } from '@mtg/kernel';
import { humanSeat, pendingDecision, reduceAll, scenario } from '@mtg/kernel';
import { GAME_LOG_LABEL } from '../../src/log/GameLog';
import { seatPossessive } from '../../src/seat';
import { castPlansFor, castStage } from '../../src/routes/play/cast';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { boardPosition } from '../../src/routes/play/position';
import { pickerLabel, pickerPanel } from '../../src/routes/play/picker';
import { buildPrompt } from '../../src/routes/play/prompt';
import type { PlayChoice } from '../../src/routes/play/prompt';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');
const GEYSER = parseCard({
  kind: 'instant',
  id: 'slc-variable-geyser',
  name: 'Variable Geyser',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 92 },
  manaCost: { hasX: true, R: 2 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
});

/** `{1}, {T}: Target creature gets +2/+2 until end of turn.` */
const PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } }],
};

/**
 * A creature whose ability text never says its own name.
 *
 * The half of `mtg-1or` the shipped fixture could not show: `activation.test.ts`
 * pings with `dealDamage`, whose printed line opens with the source's name, so
 * the source landed in the shared line there whatever the fold did with the
 * detail. An ability that names nobody is where the source has only the detail
 * to ride in.
 */
const HERALD: Card = parseCard({
  kind: 'creature',
  id: 'slc-lab-herald',
  name: 'Lab Herald',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 91 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  power: 2,
  toughness: 2,
  abilities: [PUMP],
});

/**
 * The board `mtg-cee` was measured on: an Emberflow Raider a side, and a
 * Lightning Lash in hand with six things to burn.
 *
 * The same arrangement `tools/touch-targets.ts` parks, because that is the page
 * the reading came off. Two of the six targets are the two Raiders.
 */
function skirmish(): GameState {
  return scenario({
    seed: 'test/play/move-names',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: MOUNTAIN, controller: 1 },
      { card: MOUNTAIN, controller: 1 },
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
      { card: RAIDER, controller: 1, summoningSick: false },
    ],
    hands: [
      [MOUNTAIN, RAIDER, LASH, GUARDIAN, DRAKE],
      [MOUNTAIN, RAIDER],
    ],
    active: 0,
    turn: 4,
  }).state;
}

/**
 * Two copies of one creature under one controller, in whatever state is asked.
 *
 * A 3/5 rather than the Raider, because the marked damage has to be survivable:
 * a state-based action that killed the damaged copy would leave one creature on
 * the board and nothing to tell apart.
 */
function twins(damage: readonly [number, number]): GameState {
  return scenario({
    seed: 'test/play/move-names/twins',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: GUARDIAN, controller: 0, summoningSick: false, damage: damage[0] },
      { card: GUARDIAN, controller: 0, summoningSick: false, damage: damage[1] },
    ],
    hands: [[LASH], []],
    active: 0,
    turn: 4,
  }).state;
}

/** Two of one creature under one controller, each printing an ability. */
function heralds(): GameState {
  return scenario({
    seed: 'test/play/move-names/heralds',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: HERALD, controller: 0, summoningSick: false },
      { card: HERALD, controller: 0, summoningSick: false, damage: 1 },
    ],
    active: 0,
    turn: 4,
  }).state;
}

/**
 * A modal spell (CR 700.2, CR 601.2b) whose two modes both name no target, so
 * neither one leaves an arrow in `targetSuffix` for the other to differ from —
 * the shape `mtg-rvi8` is about. `cast.test.ts`'s `SPLIT` modes disagree about
 * *whether* they target, which already produces two different arrow suffixes
 * and would pass even without the mode fix; this fixture is built the other
 * way, so the only thing separating the two rows is the mode itself.
 *
 * Hand-written rather than taken from `exampleCard`, for `cast.test.ts`'s own
 * reason: the shipped example set prints no modal card.
 */
const TWIN_VERDICT: Card = parseCard({
  kind: 'instant',
  id: 'slc-twin-verdict',
  name: 'Twin Verdict',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 96 },
  manaCost: { generic: 1 },
  colors: [],
  effects: [],
  modes: [
    { effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }] },
    { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
  ],
});

/** One Mountain, enough to pay `TWIN_VERDICT`'s cost, and nothing else. */
function modalBoard(): GameState {
  return scenario({
    seed: 'test/play/move-names/modal',
    battlefield: [{ card: MOUNTAIN, controller: 0 }],
    hands: [[TWIN_VERDICT], []],
    active: 0,
    turn: 4,
  }).state;
}

/**
 * An ability paid with CR 601.2g's `sacrificeOther`, naming no other card in
 * its own printed line — `drawCards` says nothing about what it cost, the same
 * gap `HERALD`'s `pumpUntilEndOfTurn` leaves for `mtg-1or`. Two ways to pay it
 * are two different permanents fed to the cost, which `oidsOf` never lists.
 */
const RELIC: Card = parseCard({
  kind: 'artifact',
  id: 'slc-lab-relic',
  name: 'Lab Relic',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 97 },
  manaCost: { generic: 1 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeOther: { count: 1, subtype: 'Beast' } },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** A relic and two Beasts to feed it, distinguished only by marked damage. */
function sacrificeBoard(damage: readonly [number, number]): GameState {
  return scenario({
    seed: 'test/play/move-names/sacrifice',
    battlefield: [
      { card: RELIC, controller: 0 },
      { card: GUARDIAN, controller: 0, summoningSick: false, damage: damage[0] },
      { card: GUARDIAN, controller: 0, summoningSick: false, damage: damage[1] },
    ],
    active: 0,
    turn: 4,
  }).state;
}

/**
 * The width every board in this file is enumerated at.
 *
 * Nothing here is about the enumeration cap: the subject is the phrase a surface
 * prints for a move, and the boards are small — the widest lists eleven, of
 * which seven are the casts of Lightning Lash at each of its six targets and the
 * one other spell the hand can pay for. But `DEFAULT_ENUMERATION_CAP` is one
 * global constant over every enumeration in the kernel, set for combat, and a
 * naming test that inherits it reads whatever list that number happens to leave
 * — which on a lowered cap is the same board with one of the two Raiders gone.
 * So the width is stated, and every reader below goes through `completeOn`,
 * which refuses a truncated list rather than naming what survived it.
 */
const ASKED_AT = 16;

/** A decision on `state`, refused outright when the width above did not list it all. */
function completeOn(state: GameState): Decision {
  const decision = pendingDecision(state, ASKED_AT);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  if (!decision.complete) {
    throw new Error(`the board offers more moves than ${String(ASKED_AT)}, so no phrase below is safe`);
  }
  return decision;
}

/** Every action on `state`, at the same stated width. */
function actionsOn(state: GameState): readonly Action[] {
  return completeOn(state).options;
}

function choicesOf(state: GameState, names: SeatNames = NAMES): readonly PlayChoice[] {
  return buildPrompt(state, completeOn(state), names).choices;
}

function sessionFor(state: GameState): GameSession {
  const pending = completeOn(state);
  return {
    seats: [humanSeat(NAMES[0]), humanSeat(NAMES[1])],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function nameOfButton(node: unknown): string {
  const element = node as { getAttribute(name: string): string | null; textContent?: string | null };
  return element.getAttribute('aria-label') ?? element.textContent ?? '';
}

function railButtons(): readonly unknown[] {
  return within(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).getAllByRole('button');
}

function fieldOids(state: GameState, name: string): readonly ObjectId[] {
  return state.battlefield.filter((oid) => state.objects[oid]?.card.name === name);
}

/**
 * Everything the table draws about one permanent, as a string that can be
 * compared.
 *
 * Read off the raw `GameObject` rather than through `naming.ts`, so this is a
 * statement about the position and not a restatement of the rule under test: if
 * it were built from `distinguishingLine`, "two moves that read alike act on
 * indistinguishable permanents" would be true by construction.
 */
function boardFacts(state: GameState, oid: ObjectId): string {
  const object = state.objects[oid];
  if (object === undefined) return `gone ${String(oid)}`;
  const holding = state.battlefield
    .filter((other) => state.objects[other]?.attachedTo === oid)
    .map((other) => state.objects[other]?.card.name ?? '')
    .join(',');
  return [
    object.card.name,
    String(object.controller),
    object.tapped ? 'tapped' : 'untapped',
    String(object.damage),
    String(object.counters.plusOnePlusOne),
    String(object.counters.minusOneMinusOne),
    object.attachedTo === undefined ? '' : String(object.attachedTo),
    holding,
  ].join('|');
}

function actionsOf(state: GameState): readonly Action[] {
  return actionsOn(state);
}

/**
 * Every fact behind an action that a repeated label could be hiding.
 *
 * `PlayChoice.oids` is `oidsOf`'s own view of an action — the objects a click
 * could point at — and it is deliberately narrower than the action itself:
 * `mode` names no object at all, so `oidsOf` never lists it, and `sacrifices`
 * was added for a cost `oidsOf`'s switch predates. Both are fields a label can
 * drop silently while `oids`-based sameness still calls the two rows
 * identical. This reads the whole `Action`, exhaustively over its twenty-two
 * variants the way `oidsOf` itself is exhaustive, so a repeat-guard built on
 * it is blind only to what the position truly cannot distinguish rather than
 * to whatever the label happened to print.
 *
 * Every `ObjectId` is normalized through `boardFacts` before comparing, for
 * `boardFacts`'s own reason: two ids that happen to differ are not usefully
 * different if the objects behind them read alike. Every other field — mode,
 * x, the ability index, the mana color, the accept flag — is kept literally,
 * because none of those names an object with a board position to stand in
 * for.
 */
function actionFacts(state: GameState, action: Action): string {
  const fact = (oid: ObjectId): string => boardFacts(state, oid);
  const facts = (oids: readonly ObjectId[]): string => oids.map(fact).join(',');
  const target = (choice: Target | null): string => {
    if (choice === null) return 'null';
    return choice.kind === 'player' ? `player:${String(choice.player)}` : fact(choice.oid);
  };
  const targets = (choices: readonly (Target | null)[]): string => choices.map(target).join(',');
  switch (action.type) {
    case 'passPriority':
      return 'passPriority';
    case 'playLand':
      return `playLand|${fact(action.oid)}`;
    case 'castSpell':
      return `castSpell|${fact(action.oid)}|mode:${String(action.mode)}|x:${String(action.x)}|${targets(action.targets)}`;
    case 'activateManaAbility':
      return `activateManaAbility|${fact(action.oid)}|${action.color}`;
    case 'activateAbility':
      return `activateAbility|${fact(action.oid)}|ability:${String(action.abilityIndex)}|${targets(action.targets)}|sac:${facts(action.sacrifices)}|discard:${facts(action.discards ?? [])}`;
    case 'chooseTriggerTargets':
      return `chooseTriggerTargets|${String(action.oid)}|${targets(action.targets)}`;
    case 'answerOptionalTrigger':
      return `answerOptionalTrigger|${String(action.oid)}|${String(action.accept)}`;
    case 'answerMay':
      return `answerMay|${fact(action.oid)}|${String(action.accept)}`;
    case 'answerUnless':
      return `answerUnless|${fact(action.oid)}|${String(action.pay)}`;
    case 'declareAttackers':
      return `declareAttackers|${action.attackers
        .map(
          (attack) =>
            `${fact(attack.oid)}=${typeof attack.defender === 'number' ? String(attack.defender) : fact(attack.defender.oid)}`,
        )
        .join(',')}`;
    case 'declareBlockers':
      return `declareBlockers|${action.blocks.map((block) => `${fact(block.blocker)}<-${fact(block.attacker)}`).join(',')}`;
    case 'orderBlockers':
      return `orderBlockers|${action.orders.map((order) => `${fact(order.attacker)}:${facts(order.blockers)}`).join(',')}`;
    case 'discard':
      return `discard|${facts(action.oids)}`;
    // CR 701.8a, and its own fact rather than a share of `discard` above: the
    // two carry the same fields and answer different questions, so a repeat
    // guard that collapsed them would call a cleanup and a resolving spell the
    // same move.
    case 'chooseDiscards':
      return `chooseDiscards|${facts(action.oids)}`;
    case 'scry':
      return `scry|top:${facts(action.top)}|bottom:${facts(action.bottom)}`;
    case 'searchLibrary':
      // The fail-to-find is kept literally rather than normalized, because it
      // names no object: `boardFacts` has nothing to read it off.
      return `searchLibrary|${action.found === null ? 'null' : fact(action.found)}`;
    // Its own fact rather than a share of the search above, for the reason
    // `chooseDiscards` keeps one: the two carry one field of the same shape
    // and answer different questions, and a guard that collapsed them would
    // call taking a card out of a library and taking one out of a graveyard
    // the same move.
    case 'chooseFromGraveyard':
      return `chooseFromGraveyard|${action.chosen === null ? 'null' : fact(action.chosen)}`;
    case 'mulligan':
      return 'mulligan';
    case 'keepHand':
      return `keepHand|${facts(action.bottom)}`;
    case 'keepLegend':
      return `keepLegend|${fact(action.oid)}`;
    // CR 701.17a: the same one-field shape `keepLegend` has just above, its
    // own fact for the same reason `chooseDiscards` keeps one apart from
    // `discard` — a repeat guard that collapsed the two would call an edict
    // and a legend-rule choice the same move.
    case 'sacrificePermanent':
      return `sacrificePermanent|${fact(action.oid)}`;
    case 'concede':
      return 'concede';
  }
}

describe('the enumeration a player reads', () => {
  it('names the chosen X so otherwise identical casts remain distinguishable', () => {
    const state = scenario({
      seed: 'test/play/move-names/x',
      battlefield: Array.from({ length: 5 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[GEYSER], []],
      active: 0,
      turn: 4,
    }).state;
    const labels = choicesOf(state)
      .filter((choice) => choice.kind === 'castSpell' && choice.label.includes('→ Bot'))
      .map((choice) => choice.label);
    expect(labels).toEqual([
      'Cast Variable Geyser (X=0) → Bot',
      'Cast Variable Geyser (X=1) → Bot',
      'Cast Variable Geyser (X=2) → Bot',
      'Cast Variable Geyser (X=3) → Bot',
    ]);
  });

  /**
   * The property both beads are really about. Two moves reading alike is only
   * acceptable when nothing on the table separates the things they act on: the
   * two options are then interchangeable and no press can be the wrong one.
   *
   * On this board exactly one sentence repeats, and it is two untapped basic
   * Mountains. That is the answer working rather than the answer failing, and
   * pinning the repeat by name is what keeps a second one from arriving quietly.
   */
  it('repeats a sentence only where the position it names repeats', () => {
    const state = skirmish();
    const decision = completeOn(state);
    const prompt = buildPrompt(state, decision, NAMES);
    const bySentence = new Map<string, { readonly choice: PlayChoice; readonly action: Action }[]>();
    prompt.choices.forEach((choice, at) => {
      const action = decision.options[at];
      if (action === undefined) throw new Error('a built choice outran its own decision');
      const sentence = `${choice.label} ${choice.detail ?? ''}`;
      bySentence.set(sentence, [...(bySentence.get(sentence) ?? []), { choice, action }]);
    });
    const repeated = [...bySentence.entries()].filter(([, group]) => group.length > 1);
    expect(repeated.map(([sentence]) => sentence)).toEqual(['Tap Mountain for R ']);
    // Keyed on the whole `Action` — not `choice.oids` — so a repeat that is
    // only honest because two ids happen to differ in a field the label never
    // printed (`mtg-rvi8`'s `mode`, or `sacrifices`) is still caught here.
    for (const [, group] of repeated) {
      const facts = group.map(({ action }) => actionFacts(state, action));
      expect(new Set(facts).size).toBe(1);
    }
  });

  it('names whose creature a target is, so the two Raiders are two different moves', () => {
    const aimed = choicesOf(skirmish())
      .map((choice) => choice.label)
      .filter((label) => label.includes('Emberflow Raider'));
    // One cast of the card from hand, and one burn aimed at each Raider.
    expect(aimed).toContain('Cast Lightning Lash → your Emberflow Raider');
    expect(aimed).toContain("Cast Lightning Lash → Bot's Emberflow Raider");
  });

  it('carries that distinction onto the rail, in the text and in the accessible name', () => {
    render(
      createElement(PlayView, {
        session: sessionFor(skirmish()),
        viewer: 0 as const,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const buttons = railButtons();
    const names = buttons.map(nameOfButton);
    // Two untapped Mountains are one repeated name and the only one; every other
    // move on this board is its own sentence.
    const repeated = names.filter((name, at) => names.indexOf(name) !== at);
    expect(repeated).toEqual(['Tap Mountain for R']);
    for (const phrase of ['your Emberflow Raider', "Bot's Emberflow Raider"]) {
      expect(names.filter((name) => name.endsWith(phrase))).toHaveLength(1);
    }
    // The fold prints `Cast Lightning Lash →` once, so what is left on these two
    // buttons is the whole of what separates them.
    const raiders = buttons.map(textOf).filter((text) => text.includes('Emberflow Raider'));
    expect(raiders).toContain('your Emberflow Raider');
    expect(raiders).toContain("Bot's Emberflow Raider");
  });

  it('reads the possessive off the seat label, so a hotseat table is not addressed as you', () => {
    const hotseat: SeatNames = ['Player one', 'Player two'];
    const aimed = choicesOf(skirmish(), hotseat).map((choice) => choice.label);
    expect(aimed).toContain("Cast Lightning Lash → Player one's Emberflow Raider");
    expect(aimed).toContain("Cast Lightning Lash → Player two's Emberflow Raider");
    // The rule itself is `log/narrate.ts`'s and there is one copy of it. A second
    // copy here is how `You is attacking with 4 creatures.` survived a year.
    expect(seatPossessive('You')).toBe('your');
    expect(seatPossessive('Player one')).toBe("Player one's");
  });
});

describe('two of one player own permanents', () => {
  it('are told apart by what the board shows, when the board shows anything', () => {
    const aimed = choicesOf(twins([0, 2]))
      .map((choice) => choice.label)
      .filter((label) => label.startsWith('Cast Lightning Lash → '));
    expect(aimed).toContain('Cast Lightning Lash → your Thornhide Guardian (3/5)');
    expect(aimed).toContain('Cast Lightning Lash → your Thornhide Guardian (3/5 · 2 damage marked)');
  });

  it('read alike when nothing on the board separates them, which is the true statement', () => {
    const aimed = choicesOf(twins([0, 0]))
      .map((choice) => choice.label)
      .filter((label) => label.startsWith('Cast Lightning Lash → '));
    const both = aimed.filter((label) => label.includes('Thornhide Guardian'));
    expect(both).toHaveLength(2);
    // Same card, same size, undamaged, untapped, holding nothing: the two
    // options are interchangeable and a player cannot pick the wrong one. A
    // qualifier here would be a word that separated nothing.
    expect(both[0]).toBe(both[1]);
    expect(both[0]).toBe('Cast Lightning Lash → your Thornhide Guardian');
  });

  it('separates the source of an activation as well as its target', () => {
    // `mtg-1or`: the source rides in the detail, because this ability's printed
    // line never says its own card's name. Two heralds are two details.
    const details = choicesOf(heralds())
      .filter((choice) => choice.kind === 'activateAbility')
      .map((choice) => choice.detail);
    expect(new Set(details)).toEqual(new Set(['Lab Herald (2/2)', 'Lab Herald (2/2 · 1 damage marked)']));
  });
});

/**
 * `mtg-rvi8`: the mode itself, not just the target it aims at.
 *
 * `TWIN_VERDICT`'s two modes both name no target — unlike `cast.test.ts`'s
 * `SPLIT`, whose modes disagree about *whether* they aim, which already gives
 * `targetSuffix` an arrow to tell them apart with. Here the mode is the only
 * thing that can, on the rail and in the flat per-card picker alike, since
 * both draw from `buildPrompt`'s one enumeration through the one shared
 * `choiceButton` (`choice-button.ts`).
 */
describe('a modal spell names the mode it cast, not just where', () => {
  it('prints each mode in its own words in the flat enumeration', () => {
    const options = choicesOf(modalBoard()).filter((choice) => choice.kind === 'castSpell');
    // Non-vacuity: the card carries two modes, so the kernel enumerates two.
    expect(options).toHaveLength(2);
    const labels = options.map((choice) => choice.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain('Cast Twin Verdict — You gain 3 life.');
    expect(labels).toContain('Cast Twin Verdict — Draw a card.');
  });

  it("prints each mode's own rendered words, not a fixed phrase that happens to match today", () => {
    // The property `modeWords` promises: whatever `effectsFor` + `renderEffect`
    // say a mode does is what the label says, read off the same two functions
    // rather than a phrase copied into this test by hand.
    const options = choicesOf(modalBoard()).filter((choice) => choice.kind === 'castSpell');
    const actions = actionsOf(modalBoard()).filter((action) => action.type === 'castSpell');
    expect(options).toHaveLength(actions.length);
    for (const [at, choice] of options.entries()) {
      const action = actions[at];
      if (action === undefined || action.mode === undefined)
        throw new Error('every option here announces a mode');
      const sentence = effectsFor(TWIN_VERDICT, action.mode)
        .map((effect) => renderEffect(effect, TWIN_VERDICT.name))
        .join(' ');
      expect(choice.label).toContain(sentence);
    }
    // And the two modes' words are not the same sentence, or the loop above
    // would pass even with the old, undifferentiated label.
    const sentences = TWIN_VERDICT.modes?.map((_, mode) =>
      effectsFor(TWIN_VERDICT, mode)
        .map((effect) => renderEffect(effect, TWIN_VERDICT.name))
        .join(' '),
    );
    expect(new Set(sentences).size).toBe(2);
  });

  it('is caught by the whole-action repeat guard even before the label learns to say it', () => {
    // Mirrors the sacrifice board's own version of this check below: `oids`
    // (the card alone) would call these two casts the same action, and
    // `actionFacts` must not, because `mode` is a field `oidsOf` never lists.
    const state = modalBoard();
    const actions = actionsOf(state).filter((action) => action.type === 'castSpell');
    expect(actions).toHaveLength(2);
    const facts = actions.map((action) => actionFacts(state, action));
    expect(new Set(facts).size).toBe(2);
  });

  it('carries the same distinction onto the rail', () => {
    render(
      createElement(PlayView, {
        session: sessionFor(modalBoard()),
        viewer: 0 as const,
        names: NAMES,
        onChoose: () => undefined,
      }),
    );
    const names = railButtons()
      .map(nameOfButton)
      .filter((name) => name.startsWith('Cast Twin Verdict'));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('carries the same distinction into the flat per-card picker', () => {
    const options = choicesOf(modalBoard()).filter((choice) => choice.kind === 'castSpell');
    render(
      createElement(
        'div',
        null,
        pickerPanel('Twin Verdict', options, () => undefined),
      ),
    );
    const names = within(screen.getByRole('group', { name: pickerLabel('Twin Verdict') }))
      .getAllByRole('button')
      .map(nameOfButton);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});

/**
 * The second blind spot `oidsOf` left, found while auditing the first: a
 * `sacrificeOther` payment (CR 601.2g) names permanents `oidsOf` never lists,
 * because it is not the object a click on the ability's own source names.
 */
describe('an activation names what it sacrifices, not just what it targets', () => {
  it('separates two ways to pay a sacrifice cost by the permanent each one eats', () => {
    const options = choicesOf(sacrificeBoard([0, 2])).filter((choice) => choice.kind === 'activateAbility');
    // Non-vacuity: two Beasts on the board are two ways to pay a cost of one.
    expect(options).toHaveLength(2);
    // One ability, so one shared label — the sacrifice is not the move, it is
    // what pays for it, and the detail line is where a payment belongs.
    expect(new Set(options.map((choice) => choice.label)).size).toBe(1);
    const details = options.map((choice) => choice.detail);
    expect(new Set(details).size).toBe(2);
    expect(details).toContain('Lab Relic · Sacrifice Thornhide Guardian (3/5)');
    expect(details).toContain('Lab Relic · Sacrifice Thornhide Guardian (3/5 · 2 damage marked)');
  });

  it('reads alike when nothing on the board separates what each option sacrifices', () => {
    const options = choicesOf(sacrificeBoard([0, 0])).filter((choice) => choice.kind === 'activateAbility');
    expect(options).toHaveLength(2);
    const details = options.map((choice) => choice.detail);
    // Same card, same size, undamaged: the two options really are
    // interchangeable, and `permanentName`'s own qualifier stays off — the
    // same rule `twins([0, 0])` measures above for a target rather than a
    // sacrifice.
    expect(details[0]).toBe(details[1]);
    expect(details[0]).toBe('Lab Relic · Sacrifice Thornhide Guardian');
  });

  it('is caught by the whole-action repeat guard even before the label learns to say it', () => {
    // Mirrors `'repeats a sentence only where the position it names repeats'`
    // above, but keyed on `sacrificeBoard` directly: `oids` (the source alone)
    // would call these two activations the same action, and `actionFacts`
    // must not, because `sacrifices` is a field `oidsOf` never lists.
    const state = sacrificeBoard([0, 2]);
    const actions = actionsOf(state).filter((action) => action.type === 'activateAbility');
    expect(actions).toHaveLength(2);
    const facts = actions.map((action) => actionFacts(state, action));
    expect(new Set(facts).size).toBe(2);
  });
});

/** The rail's own phrases for the six things Lightning Lash may be aimed at. */
function railTargets(state: GameState): readonly string[] {
  const lead = 'Cast Lightning Lash → ';
  return choicesOf(state)
    .filter((choice) => choice.label.startsWith(lead))
    .map((choice) => choice.label.slice(lead.length));
}

describe('one permanent, one phrase, on every surface that names it', () => {
  it('separates the two Raiders in the rail', () => {
    expect(railTargets(skirmish())).toEqual(
      expect.arrayContaining(['your Emberflow Raider', "Bot's Emberflow Raider"]),
    );
  });

  it('separates them again in the staged cast, which asks the same question by clicking', () => {
    const state = skirmish();
    const decision = completeOn(state);
    const lash = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === 'Lightning Lash');
    if (lash === undefined) throw new Error('the hand holds no Lightning Lash');
    const plan = castPlansFor(state, decision).get(lash);
    if (plan === undefined) throw new Error('the kernel enumerated no cast of Lightning Lash');
    const stage = castStage(state, NAMES, plan, []);
    if (stage === null || stage.kind !== 'targets') throw new Error('the cast asked for no target');
    const labels = stage.candidates.map((candidate) => candidate.label);
    expect(new Set(labels).size).toBe(labels.length);
    // The same phrases the rail printed, because both read `describeTarget`.
    expect(labels).toEqual(expect.arrayContaining([...railTargets(state)]));
  });

  it('separates them a third time on the stack, once the spell is cast at one of them', () => {
    const state = skirmish();
    const theirs = fieldOids(state, 'Emberflow Raider').find((oid) => state.objects[oid]?.controller === 1);
    if (theirs === undefined) throw new Error('the other seat has no Raider');
    const cast = actionsOn(state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets.some((target) => target?.kind === 'permanent' && target.oid === theirs),
    );
    if (cast === undefined) throw new Error('no enumerated cast aims at the other seat Raider');
    const onStack = reduceAll(state, [cast]).state;
    const labels = boardPosition(onStack, 0, NAMES).stack.entries.map((entry) => entry.targetLabel);
    expect(labels).toEqual(["→ Bot's Emberflow Raider"]);
  });
});

/**
 * The game log, which is the fourth surface and was the one that never learned
 * the rule (`mtg-h9s`).
 *
 * On a hotseat table, because that is where the possessive is doing the whole of
 * the work: with both seats named, `Emberflow Raider` says nothing about which
 * of the two on the table an event was about, and the ask column one span to the
 * left was already saying it.
 */
const HOTSEAT: SeatNames = ['Player one', 'Player two'];

/** The skirmish with Lightning Lash resolved on the far seat's Raider. */
function burned(): GameSession {
  const state = skirmish();
  const theirs = fieldOids(state, 'Emberflow Raider').find((oid) => state.objects[oid]?.controller === 1);
  if (theirs === undefined) throw new Error('the other seat has no Raider');
  const cast = actionsOn(state).find(
    (action) =>
      action.type === 'castSpell' &&
      action.targets.some((target) => target?.kind === 'permanent' && target.oid === theirs),
  );
  if (cast === undefined) throw new Error('no enumerated cast aims at the other seat Raider');
  const resolved = reduceAll(state, [
    cast,
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  const pending = completeOn(resolved.state);
  return {
    seats: [humanSeat(HOTSEAT[0]), humanSeat(HOTSEAT[1])],
    state: resolved.state,
    events: resolved.events,
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** The whole history, as a player reads it: the disclosure open. */
function openLog(session: GameSession, names: SeatNames): string {
  render(createElement(PlayView, { session, viewer: 0 as const, names, onChoose: () => undefined }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL},`) }));
  return textOf(screen.getByRole('region', { name: GAME_LOG_LABEL }));
}

describe('the log points at a permanent the way the rail does', () => {
  it('says whose creature the damage landed on', () => {
    const log = openLog(burned(), HOTSEAT);
    expect(log).toContain("Lightning Lash deals 3 damage to Player two's Emberflow Raider.");
    // The sentence that shipped, which named neither seat and left two Raiders
    // on the table answering to one phrase.
    expect(log).not.toContain('deals 3 damage to Emberflow Raider.');
  });

  /**
   * The other half of the per-slot rule, and the half a one-way fix breaks.
   *
   * Threading the possessive through every mention would print `Player one casts
   * Player one's Lightning Lash`, which is why `LogNames` has two card slots
   * rather than one possessive one. A source is spoken *for* and keeps its
   * printed name; only what the sentence points at is said as somebody's.
   */
  it('leaves the source of the sentence in its own name', () => {
    const log = openLog(burned(), HOTSEAT);
    expect(log).toContain('Player one casts Lightning Lash');
    expect(log).not.toContain("casts Player one's Lightning Lash");
    expect(log).not.toContain("Player one's Lightning Lash deals");
  });

  /**
   * The same two sentences on an ordinary table, where the possessive is the
   * pronoun. A fix that spelled `You's` would pass both assertions above.
   */
  it('says the near seat possessive as a pronoun when the near seat is you', () => {
    const log = openLog(burned(), NAMES);
    expect(log).toContain("Lightning Lash deals 3 damage to Bot's Emberflow Raider.");
    expect(log).toContain('You cast Lightning Lash');
  });
});
