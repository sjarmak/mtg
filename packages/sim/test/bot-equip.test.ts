/**
 * The bot has to want to pick a weapon up.
 *
 * `bot-activations.test.ts` makes this argument for an activated ability with a
 * payload, and an equip ability is the one shape that argument does not reach.
 * CR 702.6b attaches its source and prints no effect, so `ability.effects` is
 * empty, so the value the activation policy reads off the targets is zero and
 * every weapon in the set is declined at every board for as long as the game
 * lasts. Nothing goes red: the kernel attaches correctly, the enumeration
 * offers the equip at every sorcery-speed window, and the balance gate reports
 * healthy bands for a format in which no weapon was ever equipped.
 *
 * The assertions are `bot-activations`': not "the number is bigger" but "the
 * action the bot submits is the equip", taken from a real `pendingDecision`,
 * re-checked with `validateAction`, and reduced so the power is read back off
 * the layer system rather than off this file's arithmetic.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  attachmentOf,
  effectsApplyingTo,
  hasKeyword,
  pendingDecision,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  validateAction,
} from '@mtg/kernel';
import type { GreedyBotConfig } from '@mtg/sim';
import { chooseActivation, decideGreedy, DEFAULT_GREEDY_CONFIG, greedyConfig } from '@mtg/sim';
import { creature, FOREST } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

/** `Equipped creature gets +2/+0.` / `Equip {2}` — the layer 7c half. */
const MOONBLADE: Card = parseCard({
  kind: 'artifact',
  id: 'tst-moonblade',
  name: 'Moonblade',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 810 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

/** `Equipped creature has first strike.` / `Equip {1}` — the layer 6 half. */
const SCIMITAR: Card = parseCard({
  kind: 'artifact',
  id: 'tst-scimitar-of-the-dunes',
  name: 'Scimitar of the Dunes',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 811 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
      effects: [],
    },
  ],
});

/**
 * `Equipped creature gets +6/-3.` / `Equip {2}` — the weapon whose clause is
 * removal pointed at its own carrier. A policy that reads the printed
 * modification and not the body it lands on prices this at six power less three
 * toughness, which is positive at every board, and equips it onto a 2/2.
 */
const OBLITERATOR: Card = parseCard({
  kind: 'artifact',
  id: 'tst-last-blow-obliterator',
  name: 'Last-Blow Obliterator',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 812 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 6, toughness: -3 }] },
      effects: [],
    },
  ],
});

/**
 * `Equipped creature gets +0/+3.` / `Equip {1}` — the weapon a host can die
 * without. Every other clause here is safe to take off; this one is the reason
 * the loss side of a move needs a lethality check of its own.
 */
const AEGIS: Card = parseCard({
  kind: 'artifact',
  id: 'tst-aegis-of-the-vale',
  name: 'Aegis of the Vale',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 813 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonus', power: 0, toughness: 3 }] },
      effects: [],
    },
  ],
});

const KAELEN = creature('Kaelen', 2, 2);
const SERAPHINE = creature('Seraphine', 1, 3);
const ILSEN = creature('Ilsen', 2, 2, ['firstStrike']);
const SENTINEL = creature('Sentinel', 3, 5);

/**
 * Two bodies with the same power, so the printed modification is worth exactly
 * the same on both and only what the defending board can do to them separates
 * them. Both are enumerated ahead of their partner in the cases below, so
 * battlefield order picks the wrong one every time.
 */
const GRUNT = creature('Vale Grunt', 2, 2);
const SKYDANCER = creature('Skydancer', 2, 2, ['flying']);
const FRAIL = creature('Vale Runner', 2, 2);
const WARDEN = creature('Vale Warden', 2, 5);
const SCOUT = creature('Vale Scout', 2, 2);

/** The defending board: one ground creature big enough to kill what it blocks. */
const BRUTE = creature('Ogre Brute', 4, 4);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function forests(count: number): { card: Card; controller: PlayerId }[] {
  return Array.from({ length: count }, () => ({ card: FOREST, controller: 0 as PlayerId }));
}

/** A board of eight Forests, one weapon and whichever creatures the case needs. */
function board(weapon: Card, creatures: readonly Card[], seed: string): GameState {
  return scenario({
    seed,
    battlefield: [
      ...forests(8),
      { card: weapon, controller: 0 },
      ...creatures.map((card) => ({ card, controller: 0 as PlayerId })),
    ],
    hands: [[], []],
  }).state;
}

/** The same board with damage already marked on the one creature that can carry the weapon. */
function damagedBoard(weapon: Card, host: Card, damage: number, seed: string): GameState {
  return scenario({
    seed,
    battlefield: [...forests(8), { card: weapon, controller: 0 }, { card: host, controller: 0, damage }],
    hands: [[], []],
  }).state;
}

/** The same board with creatures on the other side of it. */
function contested(weapon: Card, mine: readonly Card[], theirs: readonly Card[], seed: string): GameState {
  return scenario({
    seed,
    battlefield: [
      ...forests(8),
      { card: weapon, controller: 0 },
      ...mine.map((card) => ({ card, controller: 0 as PlayerId })),
      ...theirs.map((card) => ({ card, controller: 1 as PlayerId })),
    ],
    hands: [[], []],
  }).state;
}

/**
 * Damage marked after the weapon is already attached — a creature that took it
 * in combat while carrying the thing.
 *
 * `scenario` can state marked damage and it can state a battlefield, but it
 * cannot state an attachment, because an attachment is a continuous effect the
 * equip ability registers rather than a field on the permanent. So the
 * attachment comes from the kernel (`play` submits the bot's own equip and
 * resolves it) and the damage is written onto the settled state, which is the
 * same board a combat step would have left.
 */
function withDamage(state: GameState, oid: ObjectId, damage: number): GameState {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`no object ${oid}`);
  return { ...state, objects: { ...state.objects, [oid]: { ...object, damage } } };
}

function named(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function decide(state: GameState, profile: GreedyBotConfig = config): Action {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  const action = decideGreedy({ state, player: 0, decision }, profile);
  expect(validateAction(state, action)).toBeNull();
  return action;
}

function activationFor(state: GameState, profile: GreedyBotConfig = config): Action | null {
  const decision = pendingDecision(state, 512);
  if (decision === null) throw new Error('no decision pending');
  return chooseActivation({ state, player: 0, decision }, profile);
}

/** Submits the bot's own choice and lets it resolve. */
function play(state: GameState, profile: GreedyBotConfig = config): GameState {
  const action = decide(state, profile);
  return reduceAll(reduce(state, action).state, PASS).state;
}

/** The creature an `activateAbility` action is aimed at. */
function hostOf(action: Action): ObjectId {
  if (action.type !== 'activateAbility') throw new Error(`expected an activation, got ${action.type}`);
  const target = action.targets[0];
  if (target === undefined || target === null || target.kind !== 'permanent') {
    throw new Error('equip chose no permanent');
  }
  return target.oid;
}

describe('a weapon on the battlefield', () => {
  /**
   * The risk-3 assertion for attachment. Eight untapped Forests, a creature to
   * equip and nothing else to spend mana on: a policy that reads an equip
   * ability as its (empty) effect list passes priority here, and passes it in
   * all 10,035 games of the balance gate.
   */
  it('is the action the bot submits when it has the mana and a creature to equip', () => {
    const start = board(MOONBLADE, [KAELEN], 'sim/equip/take');
    const action = decide(start);
    expect(action.type).toBe('activateAbility');
    if (action.type !== 'activateAbility') return;
    expect(start.objects[action.oid]?.card.name).toBe('Moonblade');
    expect(hostOf(action)).toBe(named(start, 'Kaelen'));
  });

  /**
   * The power is the layer system's answer, not this test's: `effectsApplyingTo`
   * is the derivation's own record of which continuous effects caught the
   * creature, so a `ptMod` from the weapon in it is the CR 613 walk having run.
   */
  it('leaves the equipped creature stronger, read back off the layer system', () => {
    const start = board(MOONBLADE, [KAELEN], 'sim/equip/power');
    const link = named(start, 'Kaelen');
    expect(powerOf(start, link)).toBe(2);

    const equipped = play(start);
    expect(attachmentOf(equipped, named(equipped, 'Moonblade'))).toBe(link);
    const applying = effectsApplyingTo(equipped, link);
    expect(applying.map((effect) => effect.kind)).toStrictEqual(['ptMod']);
    expect(applying[0]?.sourceOid).toBe(named(equipped, 'Moonblade'));
    expect(powerOf(equipped, link)).toBe(4);
  });

  /**
   * A grant is worth nothing on a creature that already has the keyword, and
   * the kernel offers both hosts, so the choice between them is the policy's
   * alone. Ilsen is enumerated first (battlefield order), which is what a bot
   * that scored every host alike would take.
   */
  it('grants a keyword to the creature that does not already have it', () => {
    const start = board(SCIMITAR, [ILSEN, SERAPHINE], 'sim/equip/keyword');
    expect(hasKeyword(start, named(start, 'Ilsen'), 'firstStrike')).toBe(true);
    const action = decide(start);
    expect(hostOf(action)).toBe(named(start, 'Seraphine'));
    expect(hasKeyword(play(start), named(start, 'Seraphine'), 'firstStrike')).toBe(true);
  });

  /**
   * Moving a weapon costs its equip cost and gains the host what the old host
   * loses, so the bot pays for the first attachment and never for the second.
   * A policy that scored the move at what attaching is worth would re-equip in
   * every main phase of every turn, which is a mana sink no card printed.
   */
  it('is not moved from the creature it is already on', () => {
    const start = board(MOONBLADE, [KAELEN, SERAPHINE], 'sim/equip/settled');
    const equipped = play(start);
    expect(attachmentOf(equipped, named(equipped, 'Moonblade'))).toBe(named(equipped, 'Kaelen'));
    expect(activationFor(equipped)).toBeNull();
    expect(decide(equipped).type).toBe('passPriority');
  });

  /** `minimumValue` is a floor on value, and it governs an equip as it governs any other activation. */
  it('is left alone when what attaching is worth does not clear the policy floor', () => {
    const start = board(MOONBLADE, [KAELEN], 'sim/equip/floor');
    const timid = greedyConfig({ activate: { minimumValue: 100 } });
    expect(activationFor(start, timid)).toBeNull();
    expect(decide(start, timid).type).toBe('passPriority');
  });

  it('is left alone when there is no creature to attach it to', () => {
    const start = board(MOONBLADE, [], 'sim/equip/nohost');
    expect(activationFor(start)).toBeNull();
  });

  /**
   * `+6/-3` on a 2/2 is removal pointed at its own carrier: the
   * clause resolves, the layer walk leaves an 8/-1, and CR 704.5e puts the
   * creature in the graveyard before anyone gets priority back. Six power less
   * three toughness is a positive figure on every scale this bot has, so the
   * only thing that can decline it is reading the body underneath.
   */
  it('is left alone when what it grants would kill the creature carrying it', () => {
    const start = board(OBLITERATOR, [KAELEN], 'sim/equip/lethal');
    expect(toughnessOf(start, named(start, 'Kaelen'))).toBe(2);
    expect(activationFor(start)).toBeNull();
    expect(decide(start).type).toBe('passPriority');
  });

  /**
   * The check is lethality and not the sign of the number: the same weapon is
   * worth picking up on a body that survives it. Kaelen is enumerated first
   * (battlefield order), so a policy that refused every negative toughness and
   * one that read no body at all both fail this.
   */
  it('goes on the creature whose toughness survives the clause', () => {
    const start = board(OBLITERATOR, [KAELEN, SENTINEL], 'sim/equip/survivor');
    const sentinel = named(start, 'Sentinel');
    expect(hostOf(decide(start))).toBe(sentinel);

    const equipped = play(start);
    expect(attachmentOf(equipped, named(equipped, 'Last-Blow Obliterator'))).toBe(sentinel);
    expect(powerOf(equipped, sentinel)).toBe(9);
    expect(toughnessOf(equipped, sentinel)).toBe(2);
  });

  /**
   * Marked damage is CR 704.5f, the other half of the question, and the layer
   * system does not carry it, so the policy has to. The 3/5 survives the clause
   * on a clean board and does not survive it with two damage already marked.
   */
  it('reads marked damage against the toughness the clause would leave', () => {
    const start = board(OBLITERATOR, [SENTINEL], 'sim/equip/damaged');
    expect(activationFor(start)).not.toBeNull();

    const hurt = damagedBoard(OBLITERATOR, SENTINEL, 2, 'sim/equip/damaged-host');
    expect(activationFor(hurt)).toBeNull();
    expect(decide(hurt).type).toBe('passPriority');
  });

  /**
   * `+2/+0` is two points of power on every body on the board, so the printed
   * modification cannot separate two 2/2s and the bot took whichever one the
   * kernel enumerated first — battlefield order, which is arrival order. What
   * separates them is the defending board: the Brute can block the Grunt and
   * cannot block a flier, so the same clause is two points of damage on one host
   * and a bigger trade on the other (`mtg-oc5a`).
   */
  it('arms the creature the defending board cannot block, not the one that arrived first', () => {
    const start = contested(MOONBLADE, [GRUNT, SKYDANCER], [BRUTE], 'sim/equip/evasive');
    expect(start.battlefield.indexOf(named(start, 'Vale Grunt'))).toBeLessThan(
      start.battlefield.indexOf(named(start, 'Skydancer')),
    );
    expect(hostOf(decide(start))).toBe(named(start, 'Skydancer'));
  });

  /**
   * The second half of the same term, on a board where neither host is evasive:
   * the Warden lives through the Brute and the Runner does not, so the clause is
   * on a body that comes back next turn rather than one that trades once.
   */
  it('arms the creature that survives its blocker when neither of them evades it', () => {
    const start = contested(MOONBLADE, [FRAIL, WARDEN], [BRUTE], 'sim/equip/survivable');
    expect(start.battlefield.indexOf(named(start, 'Vale Runner'))).toBeLessThan(
      start.battlefield.indexOf(named(start, 'Vale Warden')),
    );
    expect(hostOf(decide(start))).toBe(named(start, 'Vale Warden'));
  });

  /**
   * The loss side of a move, which is the half no printed modification can
   * answer. Both hosts survive the Brute while the Aegis is on them, so the
   * Warden is equipped first (battlefield order breaks the tie), and then it
   * takes damage. Four damage leaves a Warden that is worse to hold the weapon
   * than the Scout would be, and the bot moves it; seven leaves one that is
   * alive only because the weapon is there, and moving it is a state-based
   * action taking our own creature before priority comes back (`mtg-nvte`).
   *
   * One board and one number between the two cases, so what is being pinned is
   * the lethality check and not the arithmetic around it — the free-move guard
   * is still doing its job in the first case, which is what makes the second
   * case a refusal rather than a policy that never moves anything.
   */
  it('declines the move that kills the creature it is moving off', () => {
    const start = contested(AEGIS, [WARDEN, SCOUT], [BRUTE], 'sim/equip/loss-side');
    const equipped = play(start);
    const warden = named(equipped, 'Vale Warden');
    const scout = named(equipped, 'Vale Scout');
    expect(attachmentOf(equipped, named(equipped, 'Aegis of the Vale'))).toBe(warden);

    const bruised = withDamage(equipped, warden, 4);
    expect(toughnessOf(bruised, warden)).toBe(8);
    expect(hostOf(decide(bruised))).toBe(scout);

    const dying = withDamage(equipped, warden, 7);
    expect(activationFor(dying)).toBeNull();
    expect(decide(dying).type).toBe('passPriority');
  });
});
