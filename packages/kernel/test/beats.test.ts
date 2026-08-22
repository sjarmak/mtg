/**
 * The game, one beat at a time.
 *
 * The bug (`mtg-0sn`, observed in a real browser on the flagship set): choosing
 * an attack ran the declaration, the opponent's blocks, the damage step, end of
 * combat and the whole second main phase, and set the player down with a changed
 * life total and a log to read. The bead's own diagnosis was that the damage step
 * carries no stop by default; that diagnosis is wrong and the first block below
 * is what shows it wrong. Adding `combatDamage` to the stop set changes nothing,
 * because `mtg-hmy` made a stop conditional on the kernel having enumerated
 * something to offer, and at the damage step it has not.
 *
 * So the fix is a pause rather than a stop, and the load-bearing test here is
 * "the same combat, beat by beat": one click on an attack declaration now hands
 * the session back three times, with the attack on the board, then the blocks,
 * then the damage, and the player presses on between them. Everything else in
 * this file checks a property that trace would not notice if it broke — that a
 * beat is invisible to the recording, that a turn with no combat in it is not
 * paused at all, that a yield and a replay run straight through, and that the
 * phase bar's step-shaped reading of the same fact agrees with the event-shaped
 * one.
 *
 * **The fourth beat is a death** (`mtg-302`), and it arrived from a second
 * report of the same shape: a creature was cast, the opponent answered it with
 * removal at a priority the player held no instant for, and the cast, the
 * removal, the death and a death trigger's token all landed inside one press.
 * `test/cast-resolution.test.ts` is the kernel's acquittal — the sequence is a
 * sequence and every event in it is correct — and what was missing was a frame.
 * Measured on the flagship set over 40 seeded games before the fix: 62 settle
 * windows held a death and 48 of them halted on nothing that showed it, at a
 * median of 139 events per window. `a death is a beat` below is that fix, and
 * `a death is a beat with no step` is the half of it that shapes the type.
 *
 * **The fifth is a departure that is not a death** (`mtg-j7kj`), from the same
 * report a third time: the bot answered a creature with an exile and, in
 * The playtester's words, "it looks like it just instantly disappeared". A death beat
 * does not catch it — nothing was destroyed — and a death beat would say the
 * wrong sentence if it did, because an exile, a bounce and a tuck are three
 * different futures for the card. Measured on the flagship over 40 seeded games
 * before the fix: 6116 settle windows, 8 held a permanent leaving the
 * battlefield for a zone other than a graveyard, and all 8 halted on nothing
 * that showed it.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type {
  Beat,
  BeatSet,
  GameSession,
  GameSetup,
  GameState,
  ObjectId,
  SessionOptions,
  Step,
} from '@mtg/kernel';
import {
  advance,
  beatIn,
  botSeat,
  choose,
  COMBAT_BEATS,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_BEATS,
  FULL_CONTROL,
  getObject,
  humanSeat,
  NO_BEATS,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  STEPS,
  stepShowsBeat,
  yieldPriority,
} from '@mtg/kernel';
import { creature, instant, lands, MOUNTAIN, SWAMP } from './cards';

/** Two of these attack; the wall opposite is what makes a block worth watching. */
const RAIDER = creature('Ember Raider', 2, 2);
const WALL = creature('Basalt Bulwark', 1, 4);

/** The player's creature, and the answer the bot across the table holds. */
const WARDEN = creature('Hollow Warden', 4, 4, { cost: { generic: 2, B: 2 }, subtypes: ['Horror'] });
const UNMAKE = instant(
  'Unmake the Vessel',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  {
    B: 2,
  },
);

/** The two answers that take the creature off the board without destroying it. */
const SEAL = instant('Seal in Stone', [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }], {
  B: 2,
});
const UNDERTOW = instant('Undertow', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
  B: 2,
});

const WATCHING: SessionOptions = { autoPass: DEFAULT_AUTO_PASS, watchBeats: DEFAULT_BEATS };
const HURRYING: SessionOptions = { autoPass: DEFAULT_AUTO_PASS };

/**
 * A `GameState` from `scenario`, wrapped as the session `advance` takes.
 *
 * Seat 1 is a bot because the whole bug is about what happens *between* the
 * player's click and their next question, and a bot seat is what fills that gap:
 * it answers the block declaration inside `advance`, which is precisely the beat
 * nobody could see.
 */
function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), botSeat(simpleAgent('bot'))],
    state,
    events: [],
    result: state.result,
    pending: null,
    beat: null,
    choices: [],
    decisions: 0,
    committed: null,
  };
}

/** Player 0 holds two attackers and a land; player 1 holds one blocker. */
function combatBoard(): GameState {
  return scenario({
    seed: 'beats/v0',
    battlefield: [
      { card: RAIDER, controller: 0 },
      { card: RAIDER, controller: 0 },
      { card: WALL, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[], []],
    step: 'precombatMain',
  }).state;
}

/**
 * A dealt game, for the one assertion that has to run through `replaySession`.
 *
 * Eight creatures and seventeen lands, which is enough deck to reach a combat
 * under a driver that takes the largest option it is offered.
 */
const DEALT: GameSetup = {
  seed: 'beats/dealt',
  decks: [
    { name: 'Human Red', cards: [...lands(MOUNTAIN, 17), ...Array.from({ length: 8 }, () => RAIDER)] },
    { name: 'Bot Red', cards: [...lands(MOUNTAIN, 17), ...Array.from({ length: 8 }, () => WALL)] },
  ] as const,
  maximumTurns: 40,
};

/** A board with no creature on it at all, which is a turn with no combat in it. */
function emptyBoard(): GameState {
  return scenario({
    seed: 'beats/v0',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 1 },
    ],
    hands: [[], []],
    step: 'precombatMain',
  }).state;
}

/** The largest declaration the kernel enumerated, which is "attack with both". */
function attackWithEverything(session: GameSession): number {
  const decision = session.pending;
  if (decision === null) throw new Error('attackWithEverything: nothing is pending');
  if (decision.kind !== 'declareAttackers') {
    throw new Error(`attackWithEverything: the game is asking for "${decision.kind}"`);
  }
  return decision.options.length - 1;
}

/** Settles to the human's attack declaration and takes it. */
function declareTheAttack(options: SessionOptions): GameSession {
  const opened = advance(sessionAt(combatBoard()), options);
  return choose(opened, attackWithEverything(opened), options);
}

interface Halt {
  readonly beat: Beat;
  readonly turn: number;
  readonly step: Step;
  readonly attacking: number;
  readonly blocking: number;
  readonly life: readonly [number, number];
}

function haltAt(session: GameSession): Halt {
  const beat = session.beat;
  if (beat === null) throw new Error('haltAt: the session is not paused on a beat');
  return {
    beat,
    turn: session.state.turn.number,
    step: session.state.turn.step,
    attacking: session.state.combat.attacks.length,
    blocking: session.state.combat.blocks.length,
    life: [session.state.players[0].life, session.state.players[1].life],
  };
}

/**
 * Presses on until the game asks something or ends, collecting every pause.
 *
 * It runs past the end of the turn on purpose, because that is what auto-pass
 * does: a player who attacks and then holds nothing is not asked another
 * question until the opponent has taken a turn. The halts it gathers are
 * therefore two combats' worth, and the blocks below take the turn they mean.
 */
function watchBeats(
  session: GameSession,
  options: SessionOptions,
): {
  readonly halts: readonly Halt[];
  readonly settled: GameSession;
} {
  const halts: Halt[] = [];
  let current = session;
  for (let guard = 0; guard < 20 && current.beat !== null; guard += 1) {
    halts.push(haltAt(current));
    current = advance(current, options);
  }
  if (current.beat !== null) throw new Error('watchBeats: the session never stopped pausing');
  return { halts, settled: current };
}

/** The pauses that happened in one turn, which is one combat. */
function inTurn(halts: readonly Halt[], turn: number): readonly Halt[] {
  return halts.filter((halt) => halt.turn === turn);
}

/** Clicks a whole game through, pressing on at every pause. */
function playOn(start: GameSession, options: SessionOptions): GameSession {
  let current = start;
  for (let guard = 0; guard < 4000; guard += 1) {
    if (current.beat !== null) {
      current = advance(current, options);
      continue;
    }
    const decision = current.pending;
    if (decision === null) return current;
    current = choose(current, decision.options.length - 1, options);
  }
  throw new Error('playOn: the game never finished');
}

describe('the bug, and why the bead diagnosed it wrong', () => {
  it('runs the whole combat inside one click when nothing is watching', () => {
    const opened = advance(sessionAt(combatBoard()), HURRYING);
    const attackedOn = opened.state.turn.number;
    const clicked = choose(opened, attackWithEverything(opened), HURRYING);
    const produced = clicked.events.slice(opened.events.length);
    const types = produced.map((event) => event.type);

    // One press covers all three turn-based actions of a combat and then some.
    // The browser trace recorded the same jump on the flagship set
    // (`observations/data/g3.json`, steps 16 to 17): declare attackers to the
    // second main phase, with the opponent's life going 20 to 17.
    expect(types).toContain('attackersDeclared');
    expect(types).toContain('blockersDeclared');
    expect(types).toContain('damageDealt');
    expect(clicked.beat, 'nothing paused, so nothing was seen').toBeNull();
    expect(clicked.state.turn.number, 'the click ran past the end of the turn').toBeGreaterThan(attackedOn);
    expect(clicked.state.players[1].life, 'the opponent took the damage unseen').toBeLessThan(20);
  });

  it('is not fixed by a stop on the damage step, because there is nothing to offer there', () => {
    // The bead's own diagnosis, built and measured. `mtg-hmy` made a stop
    // conditional on the kernel having enumerated something the player can act
    // with, and at combat damage with an empty hand it has not, so this stop set
    // and the default one produce the identical game.
    const stopped: SessionOptions = {
      autoPass: {
        ...DEFAULT_AUTO_PASS,
        stops: {
          yourTurn: new Set<Step>([...DEFAULT_AUTO_PASS.stops.yourTurn, 'combatDamage']),
          theirTurn: new Set<Step>([...DEFAULT_AUTO_PASS.stops.theirTurn, 'combatDamage']),
        },
      },
    };
    const withStop = declareTheAttack(stopped);
    const without = declareTheAttack(HURRYING);

    expect(withStop.state.turn.step).toBe(without.state.turn.step);
    expect(withStop.choices).toEqual(without.choices);
    expect(stateFingerprint(withStop.state)).toBe(stateFingerprint(without.state));
  });
});

describe('the same combat, beat by beat', () => {
  it('hands the game back three times, with the attack, the blocks and the damage', () => {
    const clicked = declareTheAttack(WATCHING);
    const attackedOn = clicked.state.turn.number;
    const { halts, settled } = watchBeats(clicked, WATCHING);
    const mine = inTurn(halts, attackedOn);

    expect(mine.map((halt) => halt.beat.kind)).toEqual(['attackers', 'blockers', 'damage']);

    const [attackers, blockers, damage] = mine;
    // CR 508: the attack is declared and on the board before anything answers it.
    expect(attackers?.step).toBe('declareAttackers');
    expect(attackers?.attacking).toBe(2);
    expect(attackers?.blocking).toBe(0);
    expect(attackers?.life).toEqual([20, 20]);
    // CR 509: the opponent's answer, still with no damage on anything.
    expect(blockers?.step).toBe('declareBlockers');
    expect(blockers?.attacking).toBe(2);
    expect(blockers?.blocking).toBeGreaterThan(0);
    expect(blockers?.life).toEqual([20, 20]);
    // CR 510: the outcome, at the moment it lands.
    expect(damage?.step).toBe('combatDamage');
    expect(damage?.life[1]).toBeLessThan(20);

    expect(settled.beat).toBeNull();
    expect(settled.pending, 'the game asks its next real question').not.toBeNull();
  });

  it('pauses at a step the phase bar would draw as pausing', () => {
    // The two derivations pinned together: `beatIn` reads events and
    // `stepShowsBeat` reads steps, and the bar has only the second. A bar that
    // drew the damage node as "no stop" while the game paused there is half of
    // what the bead was filed about.
    //
    // Scoped to the combat beats, which is the population the claim is about: a
    // death has no step of its own (`BEAT_STEPS`), so a bar cannot say where it
    // will happen and does not pretend to. `a death is a beat with no step`
    // below is the other half.
    const { halts } = watchBeats(declareTheAttack(WATCHING), WATCHING);
    const combat = halts.filter((halt) => halt.beat.kind !== 'death');
    expect(combat).not.toHaveLength(0);
    for (const halt of combat) {
      expect(stepShowsBeat(halt.step, DEFAULT_BEATS), `${halt.step} pauses but is not drawn as pausing`).toBe(
        true,
      );
    }
  });

  it('never holds two beats in one action, so none of them is dropped', () => {
    // What `beatIn` returning the first rather than all of them rests on: every
    // combat step grants priority before the next is entered (CR 509.4, CR
    // 510.3), so a declaration, its blocks and its damage fall in three
    // different reduces. Measured over a whole game rather than asserted.
    let current = advance(sessionAt(combatBoard()), WATCHING);
    let seen = 0;
    for (let guard = 0; guard < 4000; guard += 1) {
      const before = current.events.length;
      if (current.beat !== null) {
        current = advance(current, WATCHING);
      } else {
        const decision = current.pending;
        if (decision === null) break;
        current = choose(current, decision.options.length - 1, WATCHING);
      }
      const produced = current.events.slice(before);
      const held = COMBAT_BEATS.filter((beat) => beatIn(produced, new Set([beat])) !== null);
      expect(held.length, `one action produced the beats ${held.join(' and ')}`).toBeLessThanOrEqual(1);
      seen += held.length;
    }
    expect(seen, 'a game with no beats in it would pass this vacuously').toBeGreaterThan(3);
  });
});

/**
 * The board `mtg-302` was reported from, stated rather than played into.
 *
 * The player's creature is already down and the player holds nothing, so
 * `canRespond` correctly declines to stop them at a priority whose only button
 * is Pass (`mtg-hmy`, and not this bead's to change). The bot holds the answer
 * and the mana for it. Everything from the player's pass to the creature in the
 * graveyard therefore happens inside one settle loop, which is exactly the
 * window the report was about.
 *
 * The answer is a parameter because `mtg-j7kj` is the same board with a
 * different card in the bot's hand: an exile and a bounce take the creature off
 * the same way through the same window, and a second copy of the arrangement
 * would be a second chance to make the two reports differ by something other
 * than the spell.
 */
function answeredBoard(answer: Card): GameState {
  return scenario({
    seed: 'beats/removal',
    battlefield: [
      { card: WARDEN, controller: 0 },
      ...lands(SWAMP, 4).map((card) => ({ card, controller: 1 as const })),
    ],
    hands: [[], [answer]],
    step: 'precombatMain',
  }).state;
}

/** That board with the destroy in it, which is the one `mtg-302` was filed from. */
function removalBoard(): GameState {
  return answeredBoard(UNMAKE);
}

/** The player's creature on that board, which is the thing that is about to die. */
function wardenOn(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => getObject(state, oid).card.name === WARDEN.name);
  if (found === undefined) throw new Error('wardenOn: the warden is not on the battlefield');
  return found;
}

describe('a death is a beat', () => {
  it('halts on the removal the player was never asked about, and names what died', () => {
    const board = removalBoard();
    const warden = wardenOn(board);
    const settled = advance(sessionAt(board), WATCHING);

    expect(settled.beat, 'the bot answered the creature and nothing stopped').toEqual({
      kind: 'death',
      oids: [warden],
    });
    // The frame is the point: the object has already left the battlefield by the
    // time anybody draws this, which is why the halt carries the id rather than
    // leaving a surface to find it again.
    expect(getObject(settled.state, warden).zone).toBe('graveyard');
    expect(settled.pending, 'a beat asks nothing').toBeNull();
  });

  it('is the whole of the difference: the hurried game runs the same death past the player', () => {
    const board = removalBoard();
    const warden = wardenOn(board);
    const hurried = advance(sessionAt(board), HURRYING);

    expect(hurried.beat, 'nothing paused, so nothing was seen').toBeNull();
    expect(getObject(hurried.state, warden).zone, 'the creature died inside the loop either way').toBe(
      'graveyard',
    );
  });

  it('costs the recording nothing, on the board that has deaths in it', () => {
    // The property the whole mechanism rests on, restated where the deaths are.
    // `what a beat costs the recording` below plays a board that trades nothing,
    // so it could hold while a death beat quietly recorded a choice; this is the
    // same claim on the board the bead was filed from.
    const paced = playOn(advance(sessionAt(removalBoard()), WATCHING), WATCHING);
    const hurried = playOn(advance(sessionAt(removalBoard()), HURRYING), HURRYING);

    expect(paced.choices).toEqual(hurried.choices);
    expect(stateFingerprint(paced.state)).toBe(stateFingerprint(hurried.state));
    expect(serializeEvents(paced.events)).toBe(serializeEvents(hurried.events));
    expect(
      paced.events.some((event) => event.type === 'permanentDestroyed'),
      'a game with no death in it would pass this vacuously',
    ).toBe(true);
  });

  it('names every permanent the batch destroyed, not the first', () => {
    // A trade takes two creatures off the board in one state-based action pass
    // (CR 704.3), and a frame that named one of them would be describing half of
    // what the player is looking at. Two 2/2s in combat is the cheapest way to
    // state it.
    const trading = scenario({
      seed: 'beats/trade',
      battlefield: [
        { card: RAIDER, controller: 0 },
        { card: RAIDER, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[], []],
      step: 'precombatMain',
    }).state;
    const deaths: SessionOptions = { autoPass: DEFAULT_AUTO_PASS, watchBeats: new Set(['death'] as const) };

    const opened = advance(sessionAt(trading), deaths);
    const clicked = choose(opened, attackWithEverything(opened), deaths);
    const { halts } = watchBeats(clicked, deaths);
    const death = halts.find((halt) => halt.beat.kind === 'death');

    expect(death, 'the two 2/2s never traded').not.toBeUndefined();
    const beat = death?.beat;
    if (beat === undefined || beat.kind !== 'death') throw new Error('the halt is not a death');
    expect(beat.oids).toHaveLength(2);
    expect(new Set(beat.oids.map((oid) => getObject(clicked.state, oid).card.name))).toEqual(
      new Set([RAIDER.name]),
    );
  });

  it('yields the batch to the combat beat when both are watched', () => {
    // Combat damage and the deaths it causes are one reduce, so the two beats
    // compete for one halt. The damage beat wins because the state-based actions
    // have already run by the time the session is handed back: its board is the
    // board with the dead creatures gone, which is the frame a death beat would
    // draw anyway. A player who has switched the combat beats off gets the death
    // instead, which is what the block above measures.
    const trading = scenario({
      seed: 'beats/trade',
      battlefield: [
        { card: RAIDER, controller: 0 },
        { card: RAIDER, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[], []],
      step: 'precombatMain',
    }).state;

    const opened = advance(sessionAt(trading), WATCHING);
    const { halts } = watchBeats(choose(opened, attackWithEverything(opened), WATCHING), WATCHING);
    const damage = halts.find((halt) => halt.beat.kind === 'damage');

    expect(damage, 'the combat never reached damage').not.toBeUndefined();
    expect(
      halts.filter((halt) => halt.beat.kind === 'death'),
      'the deaths took a halt of their own out from under the damage frame',
    ).toHaveLength(0);
    expect(damage?.step).toBe('combatDamage');
  });
});

describe('a death is a beat with no step', () => {
  it('marks no node on a turn-structure bar, watched or not', () => {
    // The other half of `pauses at a step the phase bar would draw as pausing`.
    // A death can land in any of the thirteen steps, so a bar that marked all
    // thirteen when deaths are watched would promise a pause at twelve places
    // the game usually runs straight through. `BEAT_STEPS` states the null and
    // this is what it buys.
    const deathsOnly: BeatSet = new Set(['death'] as const);
    for (const step of STEPS) {
      expect(stepShowsBeat(step, deathsOnly), `${step} claims a pause it cannot promise`).toBe(false);
    }
    // And it adds nothing to what the combat beats already mark, so switching
    // deaths on does not silently repaint the bar.
    for (const step of STEPS) {
      expect(stepShowsBeat(step, DEFAULT_BEATS)).toBe(stepShowsBeat(step, new Set(COMBAT_BEATS)));
    }
    expect(
      STEPS.some((step) => stepShowsBeat(step, DEFAULT_BEATS)),
      'nothing pauses anywhere',
    ).toBe(true);
    expect(STEPS.some((step) => stepShowsBeat(step, NO_BEATS))).toBe(false);
  });
});

describe('a departure is a beat of its own', () => {
  it('halts on the exile the player was never asked about, and names where it went', () => {
    const board = answeredBoard(SEAL);
    const warden = wardenOn(board);
    const settled = advance(sessionAt(board), WATCHING);

    expect(settled.beat, 'the bot exiled the creature and nothing stopped').toEqual({
      kind: 'departure',
      departures: [{ oid: warden, to: 'exile' }],
    });
    // The same frame argument the death beat rests on, and one step stronger:
    // an exiled permanent is not in the graveyard either, so a player who
    // missed the halt has nowhere on the board to read it off afterwards.
    expect(getObject(settled.state, warden).zone).toBe('exile');
    expect(settled.pending, 'a beat asks nothing').toBeNull();
  });

  it('says a bounce is a bounce, because it is not the same fact as an exile', () => {
    const board = answeredBoard(UNDERTOW);
    const warden = wardenOn(board);
    const settled = advance(sessionAt(board), WATCHING);

    expect(settled.beat).toEqual({ kind: 'departure', departures: [{ oid: warden, to: 'hand' }] });
    expect(getObject(settled.state, warden).zone).toBe('hand');
  });

  it('is the whole of the difference: the hurried game runs the same exile past the player', () => {
    const board = answeredBoard(SEAL);
    const warden = wardenOn(board);
    const hurried = advance(sessionAt(board), HURRYING);

    expect(hurried.beat, 'nothing paused, so nothing was seen').toBeNull();
    expect(getObject(hurried.state, warden).zone, 'the creature left inside the loop either way').toBe(
      'exile',
    );
  });

  it('is not a death, and a player watching only deaths is not stopped by it', () => {
    // The two beats are separate names because they are separate sentences, and
    // this is that separation where it is checkable: the exile board produces no
    // `permanentDestroyed` at all, so a death-only watcher runs straight through
    // the thing the bead was filed about.
    const deathsOnly: SessionOptions = {
      autoPass: DEFAULT_AUTO_PASS,
      watchBeats: new Set(['death'] as const),
    };
    const settled = advance(sessionAt(answeredBoard(SEAL)), deathsOnly);

    expect(settled.beat).toBeNull();
    expect(settled.events.some((event) => event.type === 'permanentDestroyed')).toBe(false);
  });

  it('leaves a sacrifice alone, which is the one departure the player pressed a button for', () => {
    // `beatOf` reads `zoneChanged` and never `permanentSacrificed`, so a cost
    // paid into a graveyard produces no halt. Stated as events rather than
    // played, because the flagship's sacrifice outlets are the bot's and this is
    // a claim about the classifier.
    const paid = beatIn(
      [
        { type: 'permanentSacrificed', oid: 'o1' as ObjectId, player: 0 },
        { type: 'zoneChanged', oid: 'o1' as ObjectId, from: 'battlefield', to: 'graveyard', owner: 0 },
      ],
      DEFAULT_BEATS,
    );
    expect(paid).toBeNull();
  });

  it('names every permanent the batch moved, and each one by where it went', () => {
    // One halt, two destinations, and the surface has to be able to say both:
    // `rail.ts` groups them by zone and a payload that carried ids alone could
    // not. Stated as events for the reason above — no card in the flagship
    // exiles one creature and bounces another in one resolution, and the
    // classifier has to be right for the one that eventually does.
    const mixed = beatIn(
      [
        { type: 'zoneChanged', oid: 'o1' as ObjectId, from: 'battlefield', to: 'exile', owner: 0 },
        { type: 'zoneChanged', oid: 'o2' as ObjectId, from: 'battlefield', to: 'hand', owner: 1 },
        // A card drawn in the same batch left no battlefield and is not one.
        { type: 'zoneChanged', oid: 'o3' as ObjectId, from: 'library', to: 'hand', owner: 1 },
      ],
      DEFAULT_BEATS,
    );
    expect(mixed).toEqual({
      kind: 'departure',
      departures: [
        { oid: 'o1', to: 'exile' },
        { oid: 'o2', to: 'hand' },
      ],
    });
  });

  it('marks no node on a turn-structure bar, watched or not', () => {
    // `a death is a beat with no step` restated for the beat that was added
    // second, because `BEAT_STEPS`' totality is what forced the answer and a
    // test that only covered `death` would not have noticed a `['upkeep']`
    // written in to make it compile.
    const departuresOnly: BeatSet = new Set(['departure'] as const);
    for (const step of STEPS) {
      expect(stepShowsBeat(step, departuresOnly), `${step} claims a pause it cannot promise`).toBe(false);
    }
  });

  it('costs the recording nothing, on the board that has an exile in it', () => {
    const paced = playOn(advance(sessionAt(answeredBoard(SEAL)), WATCHING), WATCHING);
    const hurried = playOn(advance(sessionAt(answeredBoard(SEAL)), HURRYING), HURRYING);

    expect(paced.choices).toEqual(hurried.choices);
    expect(stateFingerprint(paced.state)).toBe(stateFingerprint(hurried.state));
    expect(serializeEvents(paced.events)).toBe(serializeEvents(hurried.events));
    expect(
      paced.events.some(
        (event) => event.type === 'zoneChanged' && event.from === 'battlefield' && event.to === 'exile',
      ),
      'a game with no exile in it would pass this vacuously',
    ).toBe(true);
  });
});

describe('what a beat costs the recording', () => {
  it('appends nothing, so the paced game and the hurried one are the same game', () => {
    const paced = playOn(advance(sessionAt(combatBoard()), WATCHING), WATCHING);
    const hurried = playOn(advance(sessionAt(combatBoard()), HURRYING), HURRYING);

    expect(paced.choices).toEqual(hurried.choices);
    expect(stateFingerprint(paced.state)).toBe(stateFingerprint(hurried.state));
    expect(serializeEvents(paced.events)).toBe(serializeEvents(hurried.events));
    expect(paced.result).toEqual(hurried.result);
  });

  it('leaves the choice log the length the same click leaves it at either pace', () => {
    // The narrower half of the claim above, stated where a reader looks for it:
    // the press that declares the attack records one integer whether or not the
    // session stops to show it. What a *resume* records is a different matter —
    // it settles priorities, and auto-passing one is a choice like any other, so
    // this measures the click and not the pause after it.
    const paced = declareTheAttack(WATCHING);
    const hurried = declareTheAttack(HURRYING);

    expect(paced.beat).toEqual({ kind: 'attackers' });
    expect(paced.choices).toEqual(hurried.choices.slice(0, paced.choices.length));
    // Three integers: two auto-passed priorities on the way to combat and the
    // declaration itself. The other eighteen the hurried click records are the
    // passes that carried it through the blocks, the damage, the rest of the
    // turn and the whole of the opponent's — which is the jump the bead is about,
    // and it is a large enough number to be worth pinning. The paced player
    // records every one of them too, a press or three later, which is why the
    // game underneath is the same game.
    expect(paced.choices).toHaveLength(3);
    expect(hurried.choices).toHaveLength(21);
  });
});

describe('what is not paused', () => {
  it('leaves a turn with no creature in it alone', () => {
    // The friction `mtg-hmy` had just finished removing, and the reason a beat is
    // read off events rather than off entering the damage step: that step is
    // entered on every turn of every game, including this one.
    const settled = advance(sessionAt(emptyBoard()), WATCHING);
    expect(settled.beat).toBeNull();

    let current = settled;
    for (let guard = 0; guard < 40; guard += 1) {
      const decision = current.pending;
      if (decision === null) break;
      current = choose(current, 0, WATCHING);
      expect(current.beat, 'an empty board paused somewhere').toBeNull();
    }
  });

  it('lets a yield run to its boundary in one press', () => {
    // Pressed on the far side of the table with an empty hand and no creature to
    // block with, which is the position a yield actually gets pressed from and
    // the one where the whole combat falls inside the loop. A yield that honored
    // the beats would hand the game back twice inside a control whose entire
    // promise is that it does not.
    const defending = scenario({
      seed: 'beats/v0',
      battlefield: [
        { card: RAIDER, controller: 1 },
        { card: RAIDER, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[], []],
      active: 1,
      step: 'beginCombat',
    }).state;
    const watching: SessionOptions = { autoPass: FULL_CONTROL, watchBeats: DEFAULT_BEATS };
    const hurrying: SessionOptions = { autoPass: FULL_CONTROL };

    const opened = advance(sessionAt(defending), watching);
    const watched = yieldPriority(opened, 'endOfTurn', watching);
    const hurried = yieldPriority(advance(sessionAt(defending), hurrying), 'endOfTurn', hurrying);

    expect(watched.beat, 'the yield stopped to show somebody something').toBeNull();
    expect(watched.choices).toEqual(hurried.choices);
    expect(stateFingerprint(watched.state)).toBe(stateFingerprint(hurried.state));
    expect(watched.state.turn.number).toBeGreaterThan(opened.state.turn.number);
    expect(
      watched.events.slice(opened.events.length).some((event) => event.type === 'damageDealt'),
      'the yield never crossed a combat, so it proved nothing',
    ).toBe(true);
  });
});

describe('a recording made while watching', () => {
  it('replays without pausing, because a replay has nobody to pause for', () => {
    // A dealt game rather than a stated board, because this is the assertion the
    // whole invariant rests on and it has to go through the real door.
    // `replaySession` spends a list of integers by calling `choose` for each; a
    // halt hands back a session with nothing pending, so a replay that honored
    // the beats would throw on the next integer rather than pause politely.
    const seats = [humanSeat('You'), botSeat(simpleAgent('bot'))] as const;
    const played = playOn(createSession(DEALT, seats, WATCHING), WATCHING);
    expect(
      played.events.some((event) => event.type === 'damageDealt' && event.combat),
      'the recorded game had no combat in it, so it could not have paused',
    ).toBe(true);

    const replayed = replaySession(DEALT, seats, played.choices, WATCHING);

    expect(replayed.beat).toBeNull();
    expect(replayed.choices).toEqual(played.choices);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
  });
});
