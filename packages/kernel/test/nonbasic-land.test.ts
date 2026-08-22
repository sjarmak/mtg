import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  choose,
  createSession,
  eventsOfType,
  humanSeat,
  legalActions,
  playerOf,
  replaySession,
  scenario,
  serializeEvents,
  simpleAgent,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { creature, lands, MOUNTAIN, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

let collector = 220;

function land(name: string, producesMana: readonly string[], extra: Record<string, unknown> = {}): Card {
  collector += 1;
  return parseCard({
    kind: 'land',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: collector },
    producesMana,
    ...extra,
  });
}

const DRAGONSKULL = land('Dragonskull Summit', ['B', 'R'], {
  entryReplacement: {
    kind: 'entersTappedUnlessControlsLandSubtype',
    landTypes: ['Swamp', 'Mountain'],
  },
});

function play(start: ReturnType<typeof scenario>, card: Card) {
  return apply(start, { type: 'playLand', player: 0, oid: handOidOf(start.state, 0, card.name) });
}

describe('checkland arrival', () => {
  it('enters tapped without a qualifying pre-entry land and records the replacement', () => {
    const played = play(scenario({ hands: [[DRAGONSKULL], []] }), DRAGONSKULL);
    const oid = oidOf(played.state, DRAGONSKULL.name);
    expect(played.state.objects[oid]?.tapped).toBe(true);
    expect(eventsOfType(played.events, 'replacementApplied').map((event) => event.id)).toEqual([
      `intrinsic:${oid}:entry`,
    ]);
  });

  it('reads the pre-entry battlefield, so its own Swamp subtype cannot satisfy itself', () => {
    const selfTyped = land('Self Typed Summit', ['B'], {
      subtypes: ['Swamp'],
      entryReplacement: {
        kind: 'entersTappedUnlessControlsLandSubtype',
        landTypes: ['Swamp'],
      },
    });
    const played = play(scenario({ hands: [[selfTyped], []] }), selfTyped);
    expect(played.state.objects[oidOf(played.state, selfTyped.name)]?.tapped).toBe(true);
  });

  it('checks land types rather than the Basic supertype, including a dual-typed nonbasic source', () => {
    const dualTyped = land('Marsh Isle', ['U', 'B'], { subtypes: ['Island', 'Swamp'] });
    const played = play(
      scenario({ battlefield: [{ card: dualTyped, controller: 0 }], hands: [[DRAGONSKULL], []] }),
      DRAGONSKULL,
    );
    expect(dualTyped.supertypes).not.toContain('basic');
    expect(played.state.objects[oidOf(played.state, DRAGONSKULL.name)]?.tapped).toBe(false);
    expect(eventsOfType(played.events, 'replacementApplied')).toEqual([]);
  });

  it('does not count a qualifying land an opponent controls', () => {
    const played = play(
      scenario({ battlefield: [{ card: MOUNTAIN, controller: 1 }], hands: [[DRAGONSKULL], []] }),
      DRAGONSKULL,
    );
    expect(played.state.objects[oidOf(played.state, DRAGONSKULL.name)]?.tapped).toBe(true);
  });
});

describe('nonbasic land actions', () => {
  it('offers every printed mana choice immediately despite summoning sickness', () => {
    const played = play(
      scenario({ battlefield: [{ card: MOUNTAIN, controller: 0 }], hands: [[DRAGONSKULL], []] }),
      DRAGONSKULL,
    );
    const oid = oidOf(played.state, DRAGONSKULL.name);
    expect(played.state.objects[oid]?.summoningSick).toBe(true);
    const mana = legalActions(played.state).flatMap((action) =>
      action.type === 'activateManaAbility' && action.oid === oid ? [action] : [],
    );
    expect(mana.map((action) => action.color)).toEqual(['B', 'R']);
    expect(mana.every((action) => validateAction(played.state, action) === null)).toBe(true);
  });

  it('plays through the land-drop path only and still enforces one land per turn', () => {
    const start = scenario({ hands: [[DRAGONSKULL, DRAGONSKULL], []] });
    expect(
      legalActions(start.state).filter(
        (action) => action.type === 'castSpell' && action.oid === playerOf(start.state, 0).hand[0],
      ),
    ).toEqual([]);
    const played = play(start, DRAGONSKULL);
    expect(legalActions(played.state).filter((action) => action.type === 'playLand')).toEqual([]);
  });

  it('does not spend a tap-self land to pay its own activation mana cost', () => {
    const ability: AbilityInput = {
      kind: 'activated',
      cost: { mana: { generic: 1 }, tapSelf: true },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    };
    const utility = land('Utility Land', ['C'], { abilities: [ability] });
    const alone = scenario({ battlefield: [{ card: utility, controller: 0 }] });
    expect(legalActions(alone.state).filter((action) => action.type === 'activateAbility')).toEqual([]);

    const funded = scenario({
      battlefield: [
        { card: utility, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
    });
    const source = oidOf(funded.state, utility.name);
    const action = legalActions(funded.state).find(
      (candidate) => candidate.type === 'activateAbility' && candidate.oid === source,
    );
    expect(action).toBeDefined();
    if (action === undefined) return;
    const activated = apply(funded, action);
    expect(activated.state.objects[source]?.tapped).toBe(true);
    expect(activated.state.objects[oidOf(activated.state, MOUNTAIN.name)]?.tapped).toBe(true);
  });

  it('copies and replays the same typed land position deterministically', () => {
    const start = scenario({
      seed: 'nonbasic-land/copy',
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [[DRAGONSKULL], []],
    });
    const first = play(start, DRAGONSKULL);
    const second = play(start, DRAGONSKULL);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
    expect(first.events).toEqual(second.events);
  });

  it('replays a game containing checklands from choices alone', () => {
    const oneDrop = creature('Checkland Scout', 1, 1, { cost: { B: 1 } });
    const deck = {
      name: 'Checkland replay',
      cards: [
        ...Array.from({ length: 8 }, () => DRAGONSKULL),
        ...lands(SWAMP, 8),
        ...lands(MOUNTAIN, 8),
        ...Array.from({ length: 16 }, () => oneDrop),
      ],
    };
    const setup = {
      seed: 'nonbasic-land/replay',
      decks: [deck, deck] as const,
      maximumTurns: 20,
    };
    const seats = () => [humanSeat('zero'), humanSeat('one')] as const;
    const agent = simpleAgent('nonbasic-land-replay');
    let played: GameSession = createSession(setup, seats());
    for (let guard = 0; played.pending !== null && guard < 10_000; guard += 1) {
      const decision = played.pending;
      const wanted = agent.decide({ state: played.state, player: decision.player, decision });
      const index = decision.options.findIndex((option) => JSON.stringify(option) === JSON.stringify(wanted));
      if (index < 0) throw new Error('nonbasic-land replay agent chose an absent option');
      played = choose(played, index);
    }
    const replayed = replaySession(setup, seats(), played.choices);
    expect(played.choices.length).toBeGreaterThan(20);
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
  });
});
