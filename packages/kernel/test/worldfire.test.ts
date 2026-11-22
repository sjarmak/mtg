/** Worldfire through casting, simultaneous cohorts, replacements, and cleanup. */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  playerOf,
  reduce,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import {
  controlledBy,
  onlyObject,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { creature, enchantment, lands, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const WORLD_FIRE: Card = parseCard({
  kind: 'sorcery',
  id: 'm13-158-worldfire-kernel',
  name: 'Worldfire',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 158 },
  manaCost: { generic: 6, R: 3 },
  colors: ['R'],
  effects: [
    {
      kind: 'exileTarget',
      scope: 'allPermanents',
      scopeFilter: {},
      target: { kind: 'noTarget' },
    },
    { kind: 'exileHandsAndGraveyards' },
    { kind: 'setLife', amount: 1, players: 'eachPlayer' },
  ],
} as unknown as CardInput);

const GAIN_DOUBLER = enchantment('Worldfire Gain Doubler', { W: 1 }, [
  { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'doubleLifeGain' } },
]);
const LOSS_GUARD = parseCard({
  kind: 'creature',
  id: 'worldfire-loss-guard',
  name: 'Worldfire Loss Guard',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  colors: [],
  artifact: true,
  subtypes: ['Angel'],
  power: 1,
  toughness: 1,
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});
const GRAVE_REPLACER = parseCard({
  kind: 'enchantment',
  id: 'worldfire-grave-replacer',
  name: 'Worldfire Grave Replacer',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { B: 2 },
  colors: ['B'],
  abilities: [{ kind: 'staticPlayerRule', players: 'eachOpponent', rule: 'cardsToGraveyardAreExiled' }],
});
const LEAVE_WATCHER = creature('Worldfire Leave Watcher', 2, 2, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});
const OWN_HAND = creature('Worldfire Own Hand', 1, 1);
const OTHER_HAND = creature('Worldfire Other Hand', 1, 1);
const OWN_GRAVE = creature('Worldfire Own Grave', 1, 1);
const OTHER_GRAVE = creature('Worldfire Other Grave', 1, 1);
const STOLEN = creature('Worldfire Stolen Permanent', 2, 2);
const TOKEN = creature('Worldfire Token', 1, 1);
const OWN_LIBRARY = creature('Worldfire Own Library', 1, 1);
const OTHER_LIBRARY = creature('Worldfire Other Library', 1, 1);

function cast(from: ReduceResult): ReduceResult {
  const next = reduce(from.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(from.state, 0, WORLD_FIRE.name),
    targets: [null, null, null],
  });
  return { state: next.state, events: [...from.events, ...next.events] };
}

function resolveTop(from: ReduceResult): ReduceResult {
  let current = apply(from, { type: 'passPriority', player: 0 });
  current = apply(current, { type: 'passPriority', player: 1 });
  return current;
}

function objectOf(state: GameState, card: Card): ObjectId {
  const object = Object.values(state.objects).find((candidate) => candidate.card.id === card.id);
  if (object === undefined) throw new Error(`missing ${card.name}`);
  return object.oid;
}

describe('Worldfire resolution', () => {
  it('resets both seats atomically, after exiling replacement sources, and defers leave triggers', () => {
    const opened = scenario({
      life: [0, 25],
      battlefield: [
        ...lands(MOUNTAIN, 9).map((card) => ({ card, controller: 0 as const })),
        { card: GAIN_DOUBLER, controller: 0 },
        { card: LOSS_GUARD, controller: 0 },
        { card: LEAVE_WATCHER, controller: 0 },
        { card: GRAVE_REPLACER, controller: 1 },
        { card: STOLEN, controller: 1 },
        { card: TOKEN, controller: 1, token: true },
      ],
      hands: [[WORLD_FIRE, OWN_HAND], [OTHER_HAND]],
      graveyards: [[OWN_GRAVE], [OTHER_GRAVE]],
      libraries: [[OWN_LIBRARY], [OTHER_LIBRARY]],
      seed: 'worldfire/full-reset',
    });
    const stolen = oidOf(opened.state, STOLEN.name);
    const controlled = withContinuous(opened.state, [controlledBy(onlyObject(stolen), 0)]);
    const casted = cast({ state: controlled, events: opened.events });
    const redirected = withReplacements(casted.state, [
      replacement(
        { kind: 'zoneChange', owner: 0, from: 'hand', destination: 'exile', cardOnly: true },
        { kind: 'moveToZone', destination: 'graveyard' },
        { id: 'worldfire-hand-to-graveyard', ts: -1 },
      ),
    ]);
    const done = resolveTop({ state: redirected, events: casted.events });
    const spell = objectOf(done.state, WORLD_FIRE);
    const redirectedHand = objectOf(done.state, OWN_HAND);
    const token = objectOf(done.state, TOKEN);

    expect(done.state.battlefield).toEqual([]);
    expect(done.state.players.map((seat) => seat.hand)).toEqual([[], []]);
    expect(done.state.players[0].graveyard).toEqual(expect.arrayContaining([redirectedHand, spell]));
    expect(done.state.players[1].graveyard).toEqual([]);
    expect(done.state.objects[redirectedHand]?.zone).toBe('graveyard');
    expect(done.state.exile).not.toContain(redirectedHand);
    expect(done.state.objects[spell]?.zone).toBe('graveyard');
    expect(done.state.objects[token]?.zone).toBe('exile');
    expect(done.state.objects[stolen]).toMatchObject({ owner: 1, controller: 1, zone: 'exile' });
    expect(done.state.players.map((seat) => seat.life)).toEqual([1, 1]);
    expect(done.state.players.map((seat) => seat.library)).toEqual([
      [objectOf(done.state, OWN_LIBRARY)],
      [objectOf(done.state, OTHER_LIBRARY)],
    ]);
    expect(eventsOfType(done.events, 'replacementApplied').map((event) => event.id)).toContain(
      'worldfire-hand-to-graveyard',
    );
    expect(eventsOfType(done.events, 'zoneChanged')).toContainEqual(
      expect.objectContaining({ oid: token, from: 'battlefield', to: 'exile' }),
    );

    expect(eventsOfType(done.events, 'abilityTriggered').map((event) => event.condition)).toContain(
      'selfLeavesBattlefield',
    );
    expect(done.state.stack).toHaveLength(1);
    const afterTrigger = resolveTop(done);
    expect(afterTrigger.state.players.map((seat) => seat.life)).toEqual([2, 1]);
  });

  it('preserves an original Worldfire beneath a resolving copy and handles empty hands and graveyards', () => {
    const original = cast(
      scenario({
        battlefield: lands(MOUNTAIN, 9).map((card) => ({ card, controller: 0 as const })),
        hands: [[WORLD_FIRE], []],
        graveyards: [[], []],
        seed: 'worldfire/copy',
      }),
    );
    const spell = original.state.stack.at(-1)?.oid;
    if (spell === undefined) throw new Error('Worldfire was not cast');
    const copied = copySpellOnStack(beginTrace(original.state), spell);
    const afterCopy = resolveTop({
      state: copied.state,
      events: [...original.events, ...copied.events],
    });

    expect(afterCopy.state.stack.map((entry) => entry.oid)).toEqual([spell]);
    expect(afterCopy.state.objects[spell]?.zone).toBe('stack');
    expect(afterCopy.state.players.map((seat) => seat.life)).toEqual([1, 1]);
    expect(afterCopy.state.players.map((seat) => seat.hand)).toEqual([[], []]);
    expect(afterCopy.state.players.map((seat) => seat.graveyard)).toEqual([[], []]);

    const afterOriginal = resolveTop(afterCopy);
    expect(afterOriginal.state.stack).toEqual([]);
    expect(afterOriginal.state.objects[spell]?.zone).toBe('graveyard');
    expect(playerOf(afterOriginal.state, 0).graveyard).toContain(spell);
  });
});
