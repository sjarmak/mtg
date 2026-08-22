/**
 * CR 613.8: dependency ordering inside a layer.
 *
 * Every case is one where timestamp order and dependency order disagree, or
 * where they must agree and a naive implementation would break them apart.
 * Each expected value is fixed by the comprehensive rules, and each test states
 * what pure timestamp order would have produced, so a regression that quietly
 * drops the dependency pass fails loudly rather than looking plausible.
 */
import { describe, expect, it } from 'vitest';
import type { ContinuousEffect, GameState, LayerContext } from '@mtg/kernel';
import {
  characteristicsOf,
  dependencyGraph,
  derivedCharacteristics,
  hasKeyword,
  objectFilter,
  orderLayer,
  powerOf,
  printedCharacteristics,
  scenario,
  timestampOrder,
} from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';
import {
  abilities,
  battlefieldCount,
  definePt,
  onlyObject,
  pump,
  retype,
  withContinuous,
  withKeywords,
  withSubtype,
} from './continuous-helpers';

const bear = creature('Dep Bear', 2, 2, { subtypes: ['Bear'] });
const zombie = creature('Dep Zombie', 3, 3, { subtypes: ['Zombie'] });
const hawk = creature('Dep Hawk', 1, 1, { keywords: ['flying', 'vigilance'], subtypes: ['Bird'] });

function board(): GameState {
  return scenario({
    battlefield: [
      { card: bear, controller: 0 },
      { card: zombie, controller: 0 },
      { card: hawk, controller: 0 },
    ],
  }).state;
}

/** The layer's starting board: printed characteristics, nothing applied yet. */
function contextFor(state: GameState): LayerContext {
  return {
    state,
    battlefield: state.battlefield,
    map: new Map(
      state.battlefield.map((oid) => {
        const object = state.objects[oid];
        if (object === undefined) throw new Error(`missing object ${oid}`);
        return [oid, printedCharacteristics(object)];
      }),
    ),
  };
}

function idsOf(effects: readonly ContinuousEffect[]): readonly string[] {
  return effects.map((effect) => effect.id);
}

describe('CR 613.8 dependency ordering', () => {
  it('applies an earlier effect last when a later one changes what it catches', () => {
    // A (timestamp 1): creatures with flying gain vigilance.
    // B (timestamp 2): Bears gain flying.
    // A depends on B, so B applies first and the Bear ends up with both.
    // Pure timestamp order would give the Bear flying only.
    const state = board();
    const bearOid = oidOf(state, 'Dep Bear');
    const grantVigilance = abilities(withKeywords('flying'), { add: ['vigilance'] }, { id: 'A', ts: 1 });
    const grantFlying = abilities(withSubtype('Bear'), { add: ['flying'] }, { id: 'B', ts: 2 });

    const context = contextFor(state);
    expect(idsOf(orderLayer(context, [grantVigilance, grantFlying]))).toEqual(['B', 'A']);
    expect(idsOf(timestampOrder([grantVigilance, grantFlying]))).toEqual(['A', 'B']);

    const graph = dependencyGraph(context, [grantVigilance, grantFlying]);
    expect(graph.get('A')).toEqual(['B']);
    expect(graph.get('B')).toEqual([]);

    const withEffects = withContinuous(state, [grantVigilance, grantFlying]);
    expect(hasKeyword(withEffects, bearOid, 'flying')).toBe(true);
    expect(hasKeyword(withEffects, bearOid, 'vigilance')).toBe(true);
  });

  it('chains subtype grants in layer 4 in dependency order, not timestamp order', () => {
    // A (timestamp 1): Zombies are also Knights.
    // B (timestamp 2): Bears are also Zombies.
    // Applying B changes what A applies to, so A depends on B and runs second:
    // the Bear ends up Bear + Zombie + Knight. Timestamp order would stop at
    // Bear + Zombie, because A ran while the Bear was not yet a Zombie.
    const state = board();
    const bearOid = oidOf(state, 'Dep Bear');
    const zombiesAreKnights = retype(withSubtype('Zombie'), { addSubtypes: ['Knight'] }, { id: 'A', ts: 1 });
    const bearsAreZombies = retype(withSubtype('Bear'), { addSubtypes: ['Zombie'] }, { id: 'B', ts: 2 });

    expect(idsOf(orderLayer(contextFor(state), [zombiesAreKnights, bearsAreZombies]))).toEqual(['B', 'A']);

    const withEffects = withContinuous(state, [zombiesAreKnights, bearsAreZombies]);
    expect(characteristicsOf(withEffects, bearOid).subtypes).toEqual(['Bear', 'Zombie', 'Knight']);
    // The real Zombie gets Knight either way; only the Bear reveals the order.
    expect(characteristicsOf(withEffects, oidOf(state, 'Dep Zombie')).subtypes).toEqual(['Zombie', 'Knight']);
  });

  it('falls back to timestamp order when the dependencies form a loop (CR 613.8c)', () => {
    // A (timestamp 1): creatures with flying lose vigilance.
    // B (timestamp 2): creatures with vigilance lose flying.
    // The Hawk has both, so each effect changes what the other applies to and
    // neither can go first. 613.8c says ignore the dependencies: A applies, the
    // Hawk loses vigilance, and B then finds nothing with vigilance — so the
    // Hawk keeps flying.
    const state = board();
    const hawkOid = oidOf(state, 'Dep Hawk');
    const flyersLoseVigilance = abilities(
      withKeywords('flying'),
      { remove: ['vigilance'] },
      {
        id: 'A',
        ts: 1,
      },
    );
    const vigilantLoseFlying = abilities(
      withKeywords('vigilance'),
      { remove: ['flying'] },
      {
        id: 'B',
        ts: 2,
      },
    );

    const context = contextFor(state);
    const graph = dependencyGraph(context, [flyersLoseVigilance, vigilantLoseFlying]);
    expect(graph.get('A')).toEqual(['B']);
    expect(graph.get('B')).toEqual(['A']);
    expect(idsOf(orderLayer(context, [flyersLoseVigilance, vigilantLoseFlying]))).toEqual(['A', 'B']);

    const withEffects = withContinuous(state, [flyersLoseVigilance, vigilantLoseFlying]);
    expect(hasKeyword(withEffects, hawkOid, 'flying')).toBe(true);
    expect(hasKeyword(withEffects, hawkOid, 'vigilance')).toBe(false);
  });

  it('reverses the loop cleanly when the timestamps are reversed', () => {
    // Same pair, opposite timestamps: B goes first, the Hawk loses flying, and
    // A then finds no flyers — so vigilance survives instead.
    const state = board();
    const hawkOid = oidOf(state, 'Dep Hawk');
    const withEffects = withContinuous(state, [
      abilities(withKeywords('flying'), { remove: ['vigilance'] }, { id: 'A', ts: 2 }),
      abilities(withKeywords('vigilance'), { remove: ['flying'] }, { id: 'B', ts: 1 }),
    ]);
    expect(hasKeyword(withEffects, hawkOid, 'flying')).toBe(false);
    expect(hasKeyword(withEffects, hawkOid, 'vigilance')).toBe(true);
  });

  it('leaves independent same-layer effects in timestamp order', () => {
    // "Loses all abilities" does not depend on "gains vigilance": applying the
    // grant changes what the removal visibly strips, but not what it does. CR
    // 613.8a clause (b) is about the operation, so timestamp order stands and
    // the creature keeps the vigilance granted after the wipe.
    const state = board();
    const hawkOid = oidOf(state, 'Dep Hawk');
    const everything = objectFilter({ cardTypes: ['creature'] });
    const wipe = abilities(everything, { removeAll: true }, { id: 'wipe', ts: 1 });
    const grant = abilities(everything, { add: ['vigilance'] }, { id: 'grant', ts: 2 });

    const graph = dependencyGraph(contextFor(state), [wipe, grant]);
    expect(graph.get('wipe')).toEqual([]);
    expect(graph.get('grant')).toEqual([]);
    expect(idsOf(orderLayer(contextFor(state), [wipe, grant]))).toEqual(['wipe', 'grant']);

    const withEffects = withContinuous(state, [wipe, grant]);
    expect(characteristicsOf(withEffects, hawkOid).keywords).toEqual(['vigilance']);
  });

  it('leaves two pumps in the same sublayer independent', () => {
    const state = board();
    const bearOid = oidOf(state, 'Dep Bear');
    const first = pump(objectFilter({ cardTypes: ['creature'] }), 1, 0, { id: 'p1', ts: 1 });
    const second = pump(objectFilter({ cardTypes: ['creature'] }), 0, 1, { id: 'p2', ts: 2 });
    const graph = dependencyGraph(contextFor(state), [first, second]);
    expect(graph.get('p1')).toEqual([]);
    expect(graph.get('p2')).toEqual([]);

    const withEffects = withContinuous(state, [first, second]);
    expect(powerOf(withEffects, bearOid)).toBe(3);
  });

  it('never makes a characteristic-defining ability depend on a normal one', () => {
    // CR 613.8a clause (c). Both effects below live in layer 7a only if both
    // are CDAs; a CDA and a non-CDA are in different sublayers anyway, so the
    // clause is asserted directly on the relation.
    const state = board();
    const bearOid = oidOf(state, 'Dep Bear');
    const cda = definePt(
      onlyObject(bearOid),
      battlefieldCount(objectFilter({ cardTypes: ['creature'] })),
      {},
      { id: 'cda' },
    );
    const plain = pump(onlyObject(bearOid), 1, 1, { id: 'plain' });
    const graph = dependencyGraph(contextFor(state), [cda, plain]);
    expect(graph.get('cda')).toEqual([]);
    expect(graph.get('plain')).toEqual([]);
  });

  it('recomputes a characteristic-defining count after an earlier layer moves it', () => {
    // The count is read in layer 7a, so it sees the layer-4 animation even
    // though the animation has the later timestamp.
    const state = board();
    const bearOid = oidOf(state, 'Dep Bear');
    const zombieOid = oidOf(state, 'Dep Zombie');
    const countZombies = definePt(
      onlyObject(bearOid),
      battlefieldCount(withSubtype('Zombie')),
      {},
      { ts: 1 },
    );
    expect(powerOf(withContinuous(state, [countZombies]), bearOid)).toBe(1);

    const alsoZombie = retype(onlyObject(zombieOid), { addSubtypes: ['Zombie'] }, { ts: 2 });
    const hawkIsZombie = retype(onlyObject(oidOf(state, 'Dep Hawk')), { addSubtypes: ['Zombie'] }, { ts: 3 });
    const withEffects = withContinuous(state, [countZombies, alsoZombie, hawkIsZombie]);
    expect(powerOf(withEffects, bearOid)).toBe(2);
  });

  it('derives every permanent on the board in one pass', () => {
    const state = withContinuous(board(), [
      abilities(objectFilter({ cardTypes: ['creature'] }), { add: ['trample'] }),
    ]);
    const map = derivedCharacteristics(state);
    expect(map.size).toBe(3);
    for (const [, current] of map) expect(current.keywords).toContain('trample');
    // Memoized on the state object: the same state gives the very same map.
    expect(derivedCharacteristics(state)).toBe(map);
  });
});
