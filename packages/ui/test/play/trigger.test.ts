/**
 * The two trigger stops as the play surface shows them.
 *
 * A triggered ability is the one object on the stack with no card behind it
 * (CR 113.7a), so the prompt for it can only be as good as what it borrows from
 * the permanent that printed it. Both stops are tested for the same three
 * things: the label says which move it is, the detail says what the ability
 * actually reads, and the clickable object is a card that is drawn on the table
 * rather than an `ab<n>` that is drawn nowhere.
 *
 * The kernel decisions here are real ones, driven through `reduce` from a
 * `scenario()` board, because a hand-built `Decision` literal would let the
 * prompt agree with a shape the kernel never produces.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, Effect } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId } from '@mtg/kernel';
import { pendingDecision, reduce, scenario } from '@mtg/kernel';
import { buildPrompt, choicesByObject } from '../../src/routes/play/prompt';
import type { SeatNames } from '../../src/routes/play/position';

const NAMES: SeatNames = ['Player one', 'Player two'];

const PUMP: Effect = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: 1,
  target: { kind: 'targetCreature' },
};

function deathTrigger(optional: boolean): AbilityInput {
  const ability: AbilityInput = { kind: 'triggered', condition: 'selfDies', effects: [PUMP] };
  return optional ? { ...ability, optional: true } : ability;
}

function sprout(name: string, collectorNumber: number, optional: boolean): Card {
  return parseCard({
    kind: 'creature',
    id: `xmp-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
    abilities: [deathTrigger(optional)],
  });
}

const MUST = sprout('Bramble Sprout', 41, false);
const MAY = sprout('Choosy Sprout', 42, true);

const SCRUB: Card = parseCard({
  kind: 'creature',
  id: 'xmp-45',
  name: 'Thornwood Scrub',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 45 },
  manaCost: { generic: 1 },
  colors: [],
  power: 1,
  toughness: 1,
});

const VERDICT: Card = parseCard({
  kind: 'instant',
  id: 'xmp-43',
  name: 'Mortal Verdict',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 43 },
  manaCost: { generic: 1 },
  colors: [],
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
});

const FOREST = basicLand('Forest', 'XMP', 44);

function oidOf(state: GameState, name: string): ObjectId {
  const found = Object.entries(state.objects).find(([, object]) => object.card.name === name);
  if (found === undefined) throw new Error(`no object named ${name}`);
  return found[0];
}

function step(state: GameState, action: Action): GameState {
  return reduce(state, action).state;
}

/** Kill the sprout, then pass until the kernel asks something that is not priority. */
function untilStop(dying: Card): { state: GameState; decision: Decision } {
  const board = scenario({
    seed: 'ui/trigger',
    battlefield: [
      { card: dying, controller: 0 },
      { card: SCRUB, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
    ],
    hands: [[VERDICT], []],
  });
  const inHand = board.state.players[0].hand[0];
  if (inHand === undefined) throw new Error('no removal in hand');
  let state = step(board.state, {
    type: 'castSpell',
    player: 0,
    oid: inHand,
    targets: [{ kind: 'permanent', oid: oidOf(board.state, dying.name) }],
  });
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state, 512);
    if (decision === null) throw new Error('the game ended before the trigger stop');
    if (decision.kind !== 'priority') return { state, decision };
    state = step(state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('no trigger stop in 20 decisions');
}

/** Aim the optional trigger, then pass down to the "you may" the same ability reaches. */
function optionalStop(): { state: GameState; decision: Decision } {
  const aiming = untilStop(MAY);
  const aimed = aiming.decision.options[0];
  if (aimed === undefined) throw new Error('the aiming stop offered nothing');
  let state = step(aiming.state, aimed);
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state, 512);
    if (decision === null) throw new Error('the game ended before the optional stop');
    if (decision.kind !== 'priority') return { state, decision };
    state = step(state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('no optional stop in 20 decisions');
}

describe('the prompt for a trigger choosing its targets', () => {
  const { state, decision } = untilStop(MUST);
  const prompt = buildPrompt(state, decision, NAMES);

  it('is headlined as the choice it is, and names the source and the seat', () => {
    expect(decision.kind).toBe('triggerTargets');
    expect(prompt.headline).toBe('Choose targets');
    expect(prompt.explain).toContain('Bramble Sprout');
    expect(prompt.explain).toContain('Player one');
    // CR 603.3d is the whole reason this stop exists, so the sentence says it.
    expect(prompt.explain).toContain('before either player can respond');
  });

  /**
   * The verb agrees with the seat here too.
   *
   * Same defect as the opening question's (`play.test.ts`, `mtg-1ih` one route
   * over): the sentence named the seat and left the verb third-person, so an
   * ordinary table read `You chooses its targets now`. Both voices, because a
   * fix that only conjugated one way passes a test written in one voice.
   */
  it('conjugates the sentence for the seat being asked', () => {
    expect(prompt.explain).toContain('Player one chooses its targets now');
    expect(buildPrompt(state, decision, ['You', 'Bot']).explain).toContain('You choose its targets now');
  });

  it('labels every option by where it aims, never with a blank or an oid', () => {
    expect(prompt.choices.length).toBeGreaterThan(0);
    for (const choice of prompt.choices) {
      // `Aim → X` rather than `Aim at X`: the arrow is what `rail.ts` folds a
      // run on, and a trigger aimed N ways is the one decision that is
      // definitionally one ability with N aims (`mtg-1or`).
      expect(choice.label.startsWith('Aim → ')).toBe(true);
      expect(choice.label).not.toMatch(/undefined|\bab\d+\b/);
    }
    expect(prompt.choices.some((choice) => choice.label.includes('Thornwood Scrub'))).toBe(true);
  });

  it('prints the ability being aimed under every option', () => {
    for (const choice of prompt.choices) {
      expect(choice.detail).toBe('When Bramble Sprout dies, put a +1/+1 counter on target creature.');
    }
  });

  it('hangs each option off the creature being aimed at, so the table is clickable', () => {
    const byObject = choicesByObject(prompt);
    const scrub = oidOf(state, 'Thornwood Scrub');
    expect(byObject.get(scrub)?.length).toBe(1);
    // The ability object itself is drawn nowhere and must not be a key.
    for (const key of byObject.keys()) expect(key).not.toMatch(/^ab\d+$/);
  });
});

describe('the prompt for an optional trigger resolving', () => {
  const may = optionalStop();
  const prompt = buildPrompt(may.state, may.decision, NAMES);

  it('is headlined as the ability, and says the seat may decline', () => {
    expect(may.decision.kind).toBe('optionalTrigger');
    expect(prompt.headline).toBe('Triggered ability');
    expect(prompt.explain).toContain('Choosy Sprout');
    expect(prompt.explain).toContain('may decline it');
  });

  it('offers exactly two answers, and declining is one of them', () => {
    expect(prompt.choices.map((choice) => choice.label)).toEqual(['Take the trigger', 'Decline the trigger']);
  });

  it('prints the printed line, with the "may" the card says', () => {
    for (const choice of prompt.choices) {
      expect(choice.detail).toBe('When Choosy Sprout dies, you may put a +1/+1 counter on target creature.');
    }
  });

  it('hangs both answers off the permanent that triggered', () => {
    const byObject = choicesByObject(prompt);
    const source = oidOf(may.state, 'Choosy Sprout');
    expect(byObject.get(source)?.length).toBe(2);
  });
});
