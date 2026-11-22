/** Mass Polymorph's exile count, reveal window, arrivals, and remainder shuffle. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import { eventsOfType, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { artifact, creature } from './cards';

const MASS_POLYMORPH = parseCard({
  kind: 'sorcery',
  id: 'test-mass-polymorph',
  name: 'Mass Polymorph',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 64 },
  manaCost: {},
  colors: [],
  effects: [
    {
      kind: 'exileTarget',
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
    {
      kind: 'revealUntilCreatureCards',
      count: { kind: 'permanentsExiledThisResolution' },
    },
  ],
});

const PAUSED_POLYMORPH = parseCard({
  kind: 'sorcery',
  id: 'test-paused-polymorph',
  name: 'Patient Polymorph',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 65 },
  manaCost: {},
  colors: [],
  effects: [
    {
      kind: 'exileTarget',
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
    { kind: 'scry', count: 1 },
    {
      kind: 'revealUntilCreatureCards',
      count: { kind: 'permanentsExiledThisResolution' },
    },
  ],
});

function pass(state: GameState): Action {
  const player = state.turn.priority;
  if (player === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player };
}

function resolve(start: GameState): ReduceResult {
  const oid = playerOf(start, 0).hand[0];
  if (oid === undefined) throw new Error('Mass Polymorph is not in hand');
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets: [null, null] });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]);
}

function castAndPass(start: GameState, targetSlots: number): ReduceResult {
  const oid = playerOf(start, 0).hand[0];
  if (oid === undefined) throw new Error('the spell is not in hand');
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: Array.from({ length: targetSlots }, () => null),
  });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]);
}

function names(state: GameState, oids: readonly string[]): readonly string[] {
  return oids.map((oid) => state.objects[oid]?.card.name ?? '(missing)');
}

describe('Mass Polymorph resolution', () => {
  it('reveals only the shortest prefix and shuffles the revealed remainder with the unseen library', () => {
    const sacrifice = creature('Departing Seer', 1, 1);
    const first = artifact('First Omen');
    const found = creature('Found Sphinx', 4, 4);
    const unseen = creature('Unseen Wurm', 6, 6);
    const result = resolve(
      scenario({
        seed: 'm11/mass-polymorph/minimum-prefix',
        battlefield: [{ card: sacrifice, controller: 0 }],
        hands: [[MASS_POLYMORPH], []],
        libraries: [[first, found, unseen], []],
      }).state,
    );

    const reveals = eventsOfType(result.events, 'libraryTopRevealed');
    expect(reveals).toHaveLength(1);
    expect(names(result.state, reveals[0]?.oids ?? [])).toEqual([first.name, found.name]);
    expect([...names(result.state, playerOf(result.state, 0).library)].sort()).toEqual(
      [first.name, unseen.name].sort(),
    );
    expect(names(result.state, result.state.battlefield)).toContain(found.name);
    expect(names(result.state, result.state.battlefield)).not.toContain(unseen.name);
    expect(eventsOfType(result.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('counts exiled tokens, reveals a short library fully, and leaves other permanents alone', () => {
    const ownCard = creature('Departing Card', 1, 1);
    const ownCardB = creature('Departing Card B', 2, 2);
    const ownToken = creature('Departing Token', 1, 1);
    const ownArtifact = artifact('Stays Behind');
    const opposing = creature('Opposing Witness', 2, 2);
    const first = artifact('First Sign');
    const foundA = creature('First Arrival', 3, 3);
    const second = artifact('Second Sign');
    const foundB = creature('Second Arrival', 5, 5);
    const last = artifact('Last Sign');
    const result = resolve(
      scenario({
        seed: 'm11/mass-polymorph/token-short-library',
        battlefield: [
          { card: ownCard, controller: 0 },
          { card: ownCardB, controller: 0 },
          { card: ownToken, controller: 0, token: true },
          { card: ownArtifact, controller: 0 },
          { card: opposing, controller: 1 },
        ],
        hands: [[MASS_POLYMORPH], []],
        libraries: [[first, foundA, second, foundB, last], []],
      }).state,
    );

    const exiled = eventsOfType(result.events, 'zoneChanged').filter(
      (event) => event.from === 'battlefield' && event.to === 'exile',
    );
    expect(exiled).toHaveLength(3);
    const reveals = eventsOfType(result.events, 'libraryTopRevealed');
    expect(names(result.state, reveals[0]?.oids ?? [])).toEqual([
      first.name,
      foundA.name,
      second.name,
      foundB.name,
      last.name,
    ]);
    expect(names(result.state, result.state.battlefield)).toEqual(
      expect.arrayContaining([ownArtifact.name, opposing.name, foundA.name, foundB.name]),
    );
    expect([...names(result.state, playerOf(result.state, 0).library)].sort()).toEqual(
      [first.name, second.name, last.name].sort(),
    );
  });

  it('reveals nothing but still performs the instructed shuffle when no creature was exiled', () => {
    const first = artifact('First Card');
    const second = creature('Still Hidden', 2, 2);
    const result = resolve(
      scenario({
        seed: 'm11/mass-polymorph/zero',
        battlefield: [{ card: artifact('Quiet Relic'), controller: 0 }],
        hands: [[MASS_POLYMORPH], []],
        libraries: [[first, second], []],
      }).state,
    );

    expect(eventsOfType(result.events, 'libraryTopRevealed')).toEqual([]);
    expect(eventsOfType(result.events, 'libraryShuffled')).toHaveLength(1);
    expect(names(result.state, result.state.battlefield)).not.toContain(second.name);
    expect([...names(result.state, playerOf(result.state, 0).library)].sort()).toEqual(
      [first.name, second.name].sort(),
    );
  });

  it('carries the token-inclusive exile count across an intervening resolution choice', () => {
    const ownCard = creature('Patient Card', 1, 1);
    const ownToken = creature('Patient Token', 1, 1);
    const first = artifact('Patient Sign');
    const foundA = creature('Patient Arrival A', 2, 2);
    const foundB = creature('Patient Arrival B', 3, 3);
    const paused = castAndPass(
      scenario({
        seed: 'm11/mass-polymorph/pause-safe',
        battlefield: [
          { card: ownCard, controller: 0 },
          { card: ownToken, controller: 0, token: true },
        ],
        hands: [[PAUSED_POLYMORPH], []],
        libraries: [[first, foundA, foundB], []],
      }).state,
      3,
    );

    expect(paused.state.turn.awaiting).toBe('scry');
    const window = paused.state.pendingScry?.cards ?? [];
    const resumed = reduce(paused.state, { type: 'scry', player: 0, top: window, bottom: [] });

    expect(names(resumed.state, eventsOfType(resumed.events, 'libraryTopRevealed')[0]?.oids ?? [])).toEqual([
      first.name,
      foundA.name,
      foundB.name,
    ]);
    expect(names(resumed.state, resumed.state.battlefield)).toEqual(
      expect.arrayContaining([foundA.name, foundB.name]),
    );
  });
});
