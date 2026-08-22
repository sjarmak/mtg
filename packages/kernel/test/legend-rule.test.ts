/**
 * The legend rule (CR 704.5j).
 *
 * Two copies of Kaelen on one battlefield is the failure the flagship set walks
 * into in its first game, so every case here is stated as a board position and
 * checked through the real state-based-action pass rather than by calling the
 * sweep directly.
 */
import { describe, expect, it } from 'vitest';
import type { Card, ManaCostInput } from '@mtg/dsl';
import { colorsFromCost, mana, parseCard } from '@mtg/dsl';
import type {
  Action,
  DeckList,
  Decision,
  GameSession,
  GameState,
  LegendCollision,
  ObjectId,
  PlayerId,
  ReduceResult,
} from '@mtg/kernel';
import {
  beginTrace,
  botSeat,
  characteristicsOf,
  checkStateBasedActions,
  choose,
  createSession,
  createToken,
  eventsOfType,
  humanSeat,
  pendingDecision,
  pendingLegendCollision,
  reduce,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
} from '@mtg/kernel';
import { creature, instant, lands, MOUNTAIN } from './cards';
import { apply, handOidOf, oidsOf } from './helpers';
import { copies, controlledBy as controlChange, onlyObject, withContinuous } from './continuous-helpers';

let counter = 0;

function nextId(): string {
  counter += 1;
  return `lgd-${counter}`;
}

function legendaryCreature(name: string, power = 2, toughness = 2): Card {
  const cost = mana({ generic: 1 });
  return parseCard({
    kind: 'creature',
    id: nextId(),
    name,
    rarity: 'rare',
    set: { code: 'LGD', collectorNumber: counter },
    manaCost: cost,
    colors: colorsFromCost(cost),
    supertypes: ['legendary'],
    power,
    toughness,
  });
}

function legendaryArtifact(name: string, cost: ManaCostInput = { generic: 2 }): Card {
  return parseCard({
    kind: 'artifact',
    id: nextId(),
    name,
    rarity: 'rare',
    set: { code: 'LGD', collectorNumber: counter },
    manaCost: mana(cost),
    supertypes: ['legendary'],
  });
}

function graveyardNames(state: GameState, player: PlayerId): readonly string[] {
  return state.players[player].graveyard.map((oid) => state.objects[oid]?.card.name ?? '?');
}

function damageOf(state: GameState, oid: ObjectId): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`no object ${oid}`);
  return object.damage;
}

function only(oids: readonly ObjectId[]): ObjectId {
  const first = oids[0];
  if (first === undefined || oids.length !== 1) throw new Error(`expected one oid, got ${oids.length}`);
  return first;
}

/**
 * Runs the state-based actions over a hand-edited board, answering CR 704.5j
 * with `pick` for as long as the rule keeps asking.
 *
 * The answer goes through `reduce` rather than through the sweep directly,
 * because clearing the stop is the reducer's job and a test that cleared it
 * itself would be asserting against its own copy of the turn machine.
 */
function sweepKeeping(state: GameState, pick: (collision: LegendCollision) => ObjectId): GameState {
  let current = checkStateBasedActions(beginTrace(state)).state;
  for (let guard = 0; guard < 16; guard += 1) {
    const collision = pendingLegendCollision(current);
    if (collision === null || current.turn.awaiting !== 'legendRule') return current;
    const answer: Action = { type: 'keepLegend', player: collision.controller, oid: pick(collision) };
    current = reduce(current, answer).state;
  }
  throw new Error('the legend rule never stopped asking');
}

/** The same, for a board that is not in violation at all. */
function sweep(state: GameState): GameState {
  return checkStateBasedActions(beginTrace(state)).state;
}

/** The legend-rule question the kernel is blocked on; throws when it is not. */
function legendChoice(state: GameState): Extract<Decision, { kind: 'legendRule' }> {
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'legendRule') {
    throw new Error(`expected a legend rule decision, got ${decision?.kind ?? 'nothing'}`);
  }
  return decision;
}

/** Answers the pending legend-rule question by keeping the named permanent. */
function keep(current: ReduceResult, oid: ObjectId): ReduceResult {
  return apply(current, { type: 'keepLegend', player: legendChoice(current.state).player, oid });
}

/**
 * Asserts a board is not in violation at all — no collision derived, and no
 * question raised.
 *
 * Every negative control below needs this and none of them can get it from
 * counting permanents. The rule buries nothing on its own: it stops and asks,
 * so an over-triggering grouping key leaves the battlefield and both graveyards
 * exactly as they were and only `awaiting` gives it away. That is not
 * hypothetical. Keying the groups by controller alone, so two *differently*
 * named legends collide, left every one of these tests green while the kernel
 * blocked a real game on a question CR 704.5j never asks. `scenario` does not
 * catch it either — it settles and then calls `advanceToStep`, which returns on
 * the first line when the board is already at the target step and never reaches
 * its own `awaiting` guard.
 */
function expectNoLegendQuestion(state: GameState): void {
  expect(pendingLegendCollision(state)).toBeNull();
  expect(pendingDecision(state)?.kind ?? null).not.toBe('legendRule');
}

describe('the legend rule (CR 704.5j)', () => {
  it('puts the copies that were not kept into the graveyard, without destroying them', () => {
    const link = legendaryCreature('Kaelen');
    const start = scenario({
      battlefield: [
        { card: link, controller: 0, damage: 1 },
        { card: link, controller: 0 },
      ],
    });
    // The kept copy carries a damage mark, so the survivor is identified by
    // what it has been through rather than by an object id.
    const survivor = oidsOf(start.state, 'Kaelen')[0];
    if (survivor === undefined) throw new Error('both Links should be alive');
    const done = keep(start, survivor);

    expect(damageOf(done.state, survivor)).toBe(1);
    expect(graveyardNames(done.state, 0)).toEqual(['Kaelen']);
    expect(graveyardNames(done.state, 1)).toEqual([]);

    const buried = eventsOfType(done.events, 'zoneChanged').filter(
      (event) => event.from === 'battlefield' && event.to === 'graveyard',
    );
    expect(buried).toHaveLength(1);
    expect(buried[0]?.oid).not.toBe(survivor);

    // It is a put-into-graveyard, not a destruction (CR 704.5j), so nothing
    // reports it as destroyed.
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('leaves both alive when the two controllers are different', () => {
    const vorgath = legendaryCreature('Vorgath');
    const start = scenario({
      battlefield: [
        { card: vorgath, controller: 0 },
        { card: vorgath, controller: 1 },
      ],
    });
    expect(oidsOf(start.state, 'Vorgath')).toHaveLength(2);
    expect(graveyardNames(start.state, 0)).toEqual([]);
    expect(graveyardNames(start.state, 1)).toEqual([]);
    expectNoLegendQuestion(start.state);
  });

  it('leaves a legendary and a nonlegendary sharing a name alone', () => {
    const legendary = legendaryCreature('Silver Direhorn');
    const plain = creature('Silver Direhorn', 2, 2);
    const start = scenario({
      battlefield: [
        { card: legendary, controller: 0 },
        { card: plain, controller: 0 },
      ],
    });
    expect(oidsOf(start.state, 'Silver Direhorn')).toHaveLength(2);
    expect(graveyardNames(start.state, 0)).toEqual([]);
    expectNoLegendQuestion(start.state);
  });

  it('leaves two nonlegendary permanents sharing a name alone', () => {
    const brigand = creature('Brigand', 1, 1);
    const start = scenario({
      battlefield: [
        { card: brigand, controller: 0 },
        { card: brigand, controller: 0 },
      ],
    });
    expect(oidsOf(start.state, 'Brigand')).toHaveLength(2);
    expect(graveyardNames(start.state, 0)).toEqual([]);
    expectNoLegendQuestion(start.state);
  });

  it('leaves two different legends alone', () => {
    const start = scenario({
      battlefield: [
        { card: legendaryCreature('Borvald'), controller: 0 },
        { card: legendaryCreature('Nerissa'), controller: 0 },
      ],
    });
    expect(oidsOf(start.state, 'Borvald')).toHaveLength(1);
    expect(oidsOf(start.state, 'Nerissa')).toHaveLength(1);
    expect(graveyardNames(start.state, 0)).toEqual([]);
    expectNoLegendQuestion(start.state);
  });

  it('applies to noncreature permanents', () => {
    const stone = legendaryArtifact('Warding Stone');
    const start = scenario({
      battlefield: [
        { card: stone, controller: 0 },
        { card: stone, controller: 0 },
      ],
    });
    const kept = legendChoice(start.state).candidates[1];
    if (kept === undefined) throw new Error('both Warding Stones should be alive');
    const done = keep(start, kept);
    expect(oidsOf(done.state, 'Warding Stone')).toEqual([kept]);
    expect(graveyardNames(done.state, 0)).toEqual(['Warding Stone']);
  });

  it('reads control from layer 2, so taking the opponent copy makes the duplicate', () => {
    const kaviel = legendaryCreature('Kaviel');
    const start = scenario({
      battlefield: [
        { card: kaviel, controller: 0 },
        { card: kaviel, controller: 1 },
      ],
    });
    const both = oidsOf(start.state, 'Kaviel');
    const mine = both[0];
    const theirs = both[1];
    if (mine === undefined || theirs === undefined) throw new Error('both Kaviels should be alive');

    // Player 0 takes the second one. Adding the effect is a state edit and
    // nothing else: no state-based action has run yet.
    const stolen = withContinuous(start.state, [controlChange(onlyObject(theirs), 0, { ts: 1 })]);
    expect(oidsOf(stolen, 'Kaviel')).toHaveLength(2);

    const swept = sweepKeeping(stolen, () => mine);
    expect(oidsOf(swept, 'Kaviel')).toEqual([mine]);
    // It goes to its owner's graveyard, not its controller's (CR 704.5j).
    expect(graveyardNames(swept, 1)).toEqual(['Kaviel']);
    expect(graveyardNames(swept, 0)).toEqual([]);
  });

  it('performs no state-based action while the question is open, then all of them at once', () => {
    const ravik = legendaryCreature('Ravik');
    const bear = creature('Doomed Bear', 2, 2);
    // Two effects, so "between the effects" is a place the sweep could wrongly
    // land and the event order can say that it did not.
    const shrinkAndDraw = instant(
      'Legend Shrink',
      [
        { kind: 'pumpUntilEndOfTurn', power: 0, toughness: -3, target: { kind: 'targetCreature' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
      { generic: 1, R: 1 },
    );
    const start = scenario({
      battlefield: [
        { card: ravik, controller: 0 },
        { card: ravik, controller: 1 },
        { card: bear, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[shrinkAndDraw], []],
    });
    const both = oidsOf(start.state, 'Ravik');
    const mine = both[0];
    const theirs = both[1];
    if (mine === undefined || theirs === undefined) throw new Error('both Raviks should be alive');
    const bearOid = only(oidsOf(start.state, 'Doomed Bear'));

    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Legend Shrink'),
      targets: [{ kind: 'permanent', oid: bearOid }, null],
    });
    const passed = apply(cast, { type: 'passPriority', player: 0 });

    // Player 0 takes the opponent's Ravik with the spell already on the stack.
    // Adding the effect is a state edit and nothing else: both are still there.
    const stolen = {
      state: withContinuous(passed.state, [controlChange(onlyObject(theirs), 0, { ts: 1 })]),
      events: [],
    };
    expect(oidsOf(stolen.state, 'Ravik')).toHaveLength(2);

    const asked = apply(stolen, { type: 'passPriority', player: 1 });

    // The pass that raises CR 704.5j's question takes no state-based action at
    // all: the bear is at -1 toughness and still on the battlefield, which is
    // the whole reason the question can be asked before the sweep rather than
    // in the middle of it.
    expect(legendChoice(asked.state).name).toBe('Ravik');
    expect(oidsOf(asked.state, 'Ravik')).toHaveLength(2);
    expect(oidsOf(asked.state, 'Doomed Bear')).toEqual([bearOid]);
    expect(eventsOfType(asked.events, 'permanentDestroyed')).toEqual([]);

    const done = keep(asked, mine);

    // Answering runs the whole pass: the lethal-damage sweep and the legend
    // rule land together, as CR 704.3 has them.
    expect(oidsOf(done.state, 'Ravik')).toEqual([mine]);
    expect(oidsOf(done.state, 'Doomed Bear')).toEqual([]);

    const types = done.events.map((event) => event.type);
    const resolution = types.indexOf('resolutionBegan');
    const pump = types.indexOf('continuousEffectAdded');
    const draw = types.indexOf('cardDrawn');
    const bearDied = types.indexOf('permanentDestroyed');
    const buried = done.events.findIndex(
      (event) => event.type === 'zoneChanged' && event.oid === theirs && event.to === 'graveyard',
    );
    // Both effects of the spell finish before either sweep: the check is the
    // state-based-action pass, not a hook inside resolution.
    expect(resolution).toBeGreaterThanOrEqual(0);
    expect(pump).toBeGreaterThan(resolution);
    expect(draw).toBeGreaterThan(pump);
    expect(buried).toBeGreaterThan(draw);
    expect(bearDied).toBeGreaterThan(draw);
  });
  it('reads name and supertypes from layer 1, so a copy of a legend is the duplicate', () => {
    const link = legendaryCreature('Kaelen');
    const double = creature('Body Double', 2, 2);
    const start = scenario({
      battlefield: [
        { card: link, controller: 0 },
        { card: double, controller: 0 },
      ],
    });
    const linkOid = only(oidsOf(start.state, 'Kaelen'));
    const doubleOid = only(oidsOf(start.state, 'Body Double'));

    // Printed, these are two names and one supertype, so nothing has been swept.
    expect(graveyardNames(start.state, 0)).toEqual([]);

    const copied = withContinuous(start.state, [copies(onlyObject(doubleOid), linkOid, { ts: 1 })]);
    const asLink = characteristicsOf(copied, doubleOid);
    expect(asLink.name).toBe('Kaelen');
    expect(asLink.supertypes).toContain('legendary');

    // Both are offered, because both are Links as far as the board is
    // concerned; the printed legend is the one kept here.
    expect(pendingLegendCollision(sweep(copied))?.candidates).toEqual([linkOid, doubleOid]);
    const swept = sweepKeeping(copied, () => linkOid);
    expect(swept.battlefield).toContain(linkOid);
    expect(swept.battlefield).not.toContain(doubleOid);
    // The graveyard holds the copy, under the name printed on it.
    expect(graveyardNames(swept, 0)).toEqual(['Body Double']);
  });

  it('offers the copy the player has held all along, not only the one that arrived', () => {
    const kaviel = legendaryCreature('Kaviel');
    // Entry order puts the opponent's copy first, so the copy player 0 already
    // had is the newer of the two.
    const start = scenario({
      battlefield: [
        { card: kaviel, controller: 1 },
        { card: kaviel, controller: 0 },
      ],
    });
    const both = oidsOf(start.state, 'Kaviel');
    const older = both[0];
    const mine = both[1];
    if (older === undefined || mine === undefined) throw new Error('both Kaviels should be alive');

    const stolen = withContinuous(start.state, [controlChange(onlyObject(older), 0, { ts: 1 })]);

    // What caused the violation is not read: the copy taken and the copy held
    // all along are both offered, and keeping the newly taken one buries the
    // permanent player 0 has had since the game began.
    expect(pendingLegendCollision(sweep(stolen))?.candidates).toEqual([older, mine]);
    const swept = sweepKeeping(stolen, () => older);

    expect(oidsOf(swept, 'Kaviel')).toEqual([older]);
    expect(graveyardNames(swept, 0)).toEqual(['Kaviel']);
    expect(graveyardNames(swept, 1)).toEqual([]);
    expect(swept.objects[mine]?.zone).toBe('graveyard');
  });

  it('lets the copy stay and the printed legend go, when that is what the controller says', () => {
    const link = legendaryCreature('Kaelen');
    const double = creature('Body Double', 2, 2);
    // The blank enters first this time, so the permanent that changes is the
    // older one. Nothing on the board says which card was printed legendary.
    const start = scenario({
      battlefield: [
        { card: double, controller: 0 },
        { card: link, controller: 0 },
      ],
    });
    const doubleOid = only(oidsOf(start.state, 'Body Double'));
    const linkOid = only(oidsOf(start.state, 'Kaelen'));

    const copied = withContinuous(start.state, [copies(onlyObject(doubleOid), linkOid, { ts: 1 })]);
    expect(characteristicsOf(copied, doubleOid).name).toBe('Kaelen');

    const swept = sweepKeeping(copied, () => doubleOid);
    // Nothing on the board says which card was printed legendary, and the rule
    // does not ask: the blank wearing the name stays and the card printed as
    // the legend goes, because that is the answer given.
    expect(swept.battlefield).toContain(doubleOid);
    expect(swept.battlefield).not.toContain(linkOid);
    expect(graveyardNames(swept, 0)).toEqual(['Kaelen']);
  });

  it('passes over a token sharing a legend name, because a token has no supertypes', () => {
    const link = legendaryCreature('Kaelen');
    const start = scenario({ battlefield: [{ card: link, controller: 0 }] });
    const tokened = createToken(beginTrace(start.state), 0, {
      name: 'Kaelen',
      power: 1,
      toughness: 1,
      colors: [],
      subtypes: [],
      keywords: [],
    });

    const swept = checkStateBasedActions(tokened).state;
    expect(oidsOf(swept, 'Kaelen')).toHaveLength(2);
    expect(graveyardNames(swept, 0)).toEqual([]);
  });

  it('offers a token once a copy effect gives it the supertype its spec cannot', () => {
    const link = legendaryCreature('Kaelen');
    const start = scenario({ battlefield: [{ card: link, controller: 0 }] });
    const linkOid = only(oidsOf(start.state, 'Kaelen'));
    const tokened = createToken(beginTrace(start.state), 0, {
      name: 'Sylvanok',
      power: 1,
      toughness: 1,
      colors: [],
      subtypes: [],
      keywords: [],
    });
    const tokenOid = only(oidsOf(tokened.state, 'Sylvanok'));
    // A `TokenSpec` has no supertype field, so the printed list is empty and
    // layer 1 is the only way this token becomes a legend.
    expect(tokened.state.objects[tokenOid]?.card.supertypes).toEqual([]);

    const copied = withContinuous(tokened.state, [copies(onlyObject(tokenOid), linkOid, { ts: 1 })]);
    expect(characteristicsOf(copied, tokenOid).supertypes).toContain('legendary');

    const swept = sweepKeeping(copied, () => linkOid);
    expect(swept.battlefield).toEqual([linkOid]);
    // CR 704.5j puts it in its owner's graveyard, and the state-based action
    // for a token outside the battlefield (CR 704.5d) takes it from there to
    // exile in the same sweep, so nothing is left in the graveyard.
    expect(swept.objects[tokenOid]?.zone).toBe('exile');
    expect(graveyardNames(swept, 0)).toEqual([]);
  });
});

/**
 * The half of CR 704.5j that is a decision: "that player chooses one of them".
 *
 * The rule used to keep the oldest permanent and bury the rest, which is a
 * legal board reached by a choice nobody made. Every test here is written so
 * that a tiebreak standing in for the controller goes red — the copy kept is
 * never the one entry order would have kept.
 */
describe('the legend rule asks its controller (CR 704.5j)', () => {
  it('stops and asks rather than choosing, and buries nothing until it is answered', () => {
    const link = legendaryCreature('Kaelen');
    const start = scenario({
      battlefield: [
        { card: link, controller: 0, damage: 1 },
        { card: link, controller: 0 },
      ],
    });

    const decision = legendChoice(start.state);
    expect(decision.player).toBe(0);
    expect(decision.name).toBe('Kaelen');
    expect(decision.candidates).toEqual(oidsOf(start.state, 'Kaelen'));
    expect(decision.options).toHaveLength(2);

    // Both are still on the battlefield and neither graveyard has moved: the
    // question is asked before any state-based action of this pass is taken.
    expect(oidsOf(start.state, 'Kaelen')).toHaveLength(2);
    expect(graveyardNames(start.state, 0)).toEqual([]);
  });

  it('keeps the copy its controller named, not the one that entered first', () => {
    const link = legendaryCreature('Kaelen');
    // The older copy carries the damage, so keeping the newer one is visible in
    // the survivor rather than only in an object id.
    const start = scenario({
      battlefield: [
        { card: link, controller: 0, damage: 1 },
        { card: link, controller: 0 },
      ],
    });
    const both = oidsOf(start.state, 'Kaelen');
    const older = both[0];
    const newer = both[1];
    if (older === undefined || newer === undefined) throw new Error('both Links should be alive');

    const done = keep(start, newer);
    expect(oidsOf(done.state, 'Kaelen')).toEqual([newer]);
    expect(damageOf(done.state, newer)).toBe(0);
    expect(done.state.objects[older]?.zone).toBe('graveyard');
    expect(graveyardNames(done.state, 0)).toEqual(['Kaelen']);
    expect(pendingDecision(done.state)?.kind).toBe('priority');

    // Still a put-into-graveyard rather than a destruction, whoever chose.
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });

  it('asks once for three copies and buries the two the controller did not keep', () => {
    const sentinel = legendaryCreature('Sentinel');
    const start = scenario({
      battlefield: [
        { card: sentinel, controller: 0 },
        { card: sentinel, controller: 0 },
        { card: sentinel, controller: 0, damage: 1 },
      ],
    });
    const all = oidsOf(start.state, 'Sentinel');
    const last = all[2];
    if (last === undefined) throw new Error('three Sentinels should be alive');
    expect(legendChoice(start.state).options).toHaveLength(3);

    const done = keep(start, last);
    expect(oidsOf(done.state, 'Sentinel')).toEqual([last]);
    expect(graveyardNames(done.state, 0)).toEqual(['Sentinel', 'Sentinel']);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('asks the controller of the duplicates, not the active player', () => {
    const vorgath = legendaryCreature('Vorgath');
    const start = scenario({
      active: 0,
      battlefield: [
        { card: vorgath, controller: 1 },
        { card: vorgath, controller: 1 },
      ],
    });
    const decision = legendChoice(start.state);
    expect(decision.player).toBe(1);
    expect(start.state.turn.active).toBe(0);

    const both = oidsOf(start.state, 'Vorgath');
    const newer = both[1];
    if (newer === undefined) throw new Error('both Vorgaths should be alive');
    const done = keep(start, newer);
    expect(oidsOf(done.state, 'Vorgath')).toEqual([newer]);
    // The loser goes to its owner's graveyard, which here is its controller's.
    expect(graveyardNames(done.state, 1)).toEqual(['Vorgath']);
    expect(graveyardNames(done.state, 0)).toEqual([]);
  });

  it('refuses an answer that names a permanent outside the collision', () => {
    const shalira = legendaryCreature('Shalira');
    const start = scenario({
      battlefield: [
        { card: shalira, controller: 0 },
        { card: shalira, controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 0 },
      ],
    });
    const brigand = oidsOf(start.state, 'Brigand')[0];
    if (brigand === undefined) throw new Error('the Brigand should be on the battlefield');
    expect(() => apply(start, { type: 'keepLegend', player: 0, oid: brigand })).toThrow(
      /not one of the Shalira permanents/,
    );
    // And the other seat cannot answer for the controller.
    expect(() =>
      apply(start, { type: 'keepLegend', player: 1, oid: legendChoice(start.state).candidates[0] ?? '' }),
    ).toThrow(/decision/);
  });

  it('asks one collision at a time when two are pending at once', () => {
    const link = legendaryCreature('Kaelen');
    const sentinel = legendaryCreature('Sentinel');
    const start = scenario({
      battlefield: [
        { card: link, controller: 0 },
        { card: sentinel, controller: 0 },
        { card: link, controller: 0 },
        { card: sentinel, controller: 0 },
      ],
    });
    const links = oidsOf(start.state, 'Kaelen');
    const sentinels = oidsOf(start.state, 'Sentinel');
    const keptLink = links[1];
    const keptSentinel = sentinels[1];
    if (keptLink === undefined || keptSentinel === undefined) throw new Error('four legends should be alive');

    const first = legendChoice(start.state);
    expect(first.name).toBe('Kaelen');
    const afterLink = keep(start, keptLink);

    const second = legendChoice(afterLink.state);
    expect(second.name).toBe('Sentinel');
    const done = keep(afterLink, keptSentinel);

    expect(done.state.battlefield).toEqual([keptLink, keptSentinel]);
    expect(graveyardNames(done.state, 0)).toEqual(['Kaelen', 'Sentinel']);
  });

  it('offers the same options in the same order every time, so a recorded index replays', () => {
    const link = legendaryCreature('Kaelen');
    const build = (): ReduceResult =>
      scenario({
        seed: 'legend-replay',
        battlefield: [
          { card: link, controller: 0, damage: 1 },
          { card: link, controller: 0 },
        ],
      });
    const first = build();
    const second = build();

    const optionsOf = (state: GameState): readonly string[] =>
      legendChoice(state).options.map((option) => JSON.stringify(option));
    expect(optionsOf(first.state)).toEqual(optionsOf(second.state));

    // The recording is an index into that list, so spending the same integer on
    // a rebuilt position has to land on the same events and the same position.
    const index = 1;
    const chosen = legendChoice(first.state).options[index];
    const same = legendChoice(second.state).options[index];
    if (chosen === undefined || same === undefined) throw new Error('option 1 should be offered');
    const left = apply(first, chosen);
    const right = apply(second, same);
    expect(serializeEvents(left.events)).toEqual(serializeEvents(right.events));
    expect(stateFingerprint(left.state)).toBe(stateFingerprint(right.state));
  });
});

/**
 * The same claim one layer up, in a real game rather than a stated board.
 *
 * A deck of one legend is the shortest route to the collision arising by
 * itself, and the test asserts that it *did* arise before it asserts anything
 * about the replay — a determinism test that never reached the new decision
 * would be green about nothing.
 */
describe('a recorded game replays the legend choice', () => {
  const HERO = legendaryCreature('Hero of Vantia', 2, 2);

  function legendDeck(name: string): DeckList {
    return { name, cards: [...lands(MOUNTAIN, 20), ...Array.from({ length: 20 }, () => HERO)] };
  }

  const SETUP = {
    seed: 'legend-rule/session',
    decks: [legendDeck('Legends'), legendDeck('Legends')] as const,
    maximumTurns: 20,
  };

  const seats = [humanSeat('player'), botSeat(simpleAgent('bot'))] as const;

  const agent = simpleAgent('mirror');

  /**
   * Clicks whatever the agent would have chosen, and counts the legend-rule
   * questions along the way.
   *
   * Driven by an agent rather than by "always option 0", which is a player who
   * only ever passes and never casts a second copy of anything — so the
   * collision this test is about would never arise. Finding the agent's action
   * inside `options` is also the assertion that a human can point at every move
   * a bot can reach, `session.test.ts`' reason for the same driver.
   */
  function play(): { readonly session: GameSession; readonly asked: number } {
    let session = createSession(SETUP, seats);
    let asked = 0;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const decision = session.pending;
      if (decision === null) return { session, asked };
      if (decision.kind === 'legendRule') asked += 1;
      const wanted = JSON.stringify(
        agent.decide({ state: session.state, player: decision.player, decision }),
      );
      const index = decision.options.findIndex((option) => JSON.stringify(option) === wanted);
      if (index < 0) throw new Error(`the agent chose an action outside the ${decision.kind} options`);
      session = choose(session, index);
    }
    throw new Error('the session never stopped asking');
  }

  it('records the choice as an index and replays byte for byte', () => {
    const { session, asked } = play();
    expect(asked, 'no legend rule decision arose, so this test asserts nothing').toBeGreaterThan(0);

    const replayed = replaySession(SETUP, seats, session.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
    expect(serializeEvents(replayed.events)).toEqual(serializeEvents(session.events));
  });
});
