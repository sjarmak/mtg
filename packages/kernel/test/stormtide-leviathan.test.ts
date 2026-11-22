/** Stormtide Leviathan through the layer walk, mana, and hostile attack declarations. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  effectsApplyingTo,
  eligibleAttackers,
  hasSubtype,
  legalActions,
  moveObject,
  scenario,
  stateFingerprint,
  validateAction,
  type GameState,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, onlyObject, retype, withContinuous } from './continuous-helpers';
import { creature, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const STORMTIDE_LEVIATHAN = parseCard({
  kind: 'creature',
  id: 'm11-074-stormtide-leviathan-kernel',
  name: 'Stormtide Leviathan',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 74 },
  colors: ['U'],
  manaCost: { generic: 5, U: 3 },
  power: 8,
  toughness: 8,
  subtypes: ['Leviathan'],
  keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
  abilities: [
    {
      kind: 'static',
      scope: 'allLands',
      subtype: null,
      modification: { kind: 'addSubtype', subtype: 'Island' },
    },
    {
      kind: 'static',
      scope: 'allCreatures',
      subtype: null,
      modification: {
        kind: 'cantAttackWithoutAnyOf',
        anyOf: [
          { kind: 'keyword', keyword: 'flying' },
          { kind: 'landwalk', landType: 'Island' },
        ],
      },
    },
  ],
});

const VANILLA = creature('Stormtide Vanilla', 2, 2);
const FLIER = creature('Stormtide Flier', 2, 2, { keywords: ['flying'] });
const ISLANDWALKER = creature('Stormtide Islandwalker', 2, 2, {
  keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
});
const FORESTWALKER = creature('Stormtide Forestwalker', 2, 2, {
  keywordAbilities: [{ kind: 'landwalk', landType: 'Forest' }],
});
const COPY_BODY = creature('Stormtide Copy Body', 1, 1);

function manaColors(state: GameState, oid: string): readonly string[] {
  return legalActions(state).flatMap((action) =>
    action.type === 'activateManaAbility' && action.oid === oid ? [action.color] : [],
  );
}

describe('Stormtide Leviathan in the kernel', () => {
  it('adds Island without replacing Mountain and exposes both intrinsic mana abilities', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      active: 0,
    });
    const mountain = oidOf(start.state, MOUNTAIN.name);

    expect(hasSubtype(start.state, mountain, 'Mountain')).toBe(true);
    expect(hasSubtype(start.state, mountain, 'Island')).toBe(true);
    expect(manaColors(start.state, mountain)).toEqual(expect.arrayContaining(['R', 'U']));

    const floated = apply(start, {
      type: 'activateManaAbility',
      player: 0,
      oid: mountain,
      color: 'U',
    });
    expect(floated.state.players[0].pool.U).toBe(1);
  });

  it('admits only current flying or exact Islandwalk, after ordinary attack requirements', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: VANILLA, controller: 0, summoningSick: false },
        { card: FLIER, controller: 0, summoningSick: false },
        { card: ISLANDWALKER, controller: 0, summoningSick: false },
        { card: FORESTWALKER, controller: 0, summoningSick: false },
        { card: FLIER, controller: 0, summoningSick: true },
      ],
      active: 0,
      step: 'declareAttackers',
    });
    const vanilla = oidOf(start.state, VANILLA.name);
    const islandwalker = oidOf(start.state, ISLANDWALKER.name);
    const forestwalker = oidOf(start.state, FORESTWALKER.name);
    const eligible = eligibleAttackers(start.state);
    const fliers = start.state.battlefield.filter(
      (oid) => start.state.objects[oid]?.card.name === FLIER.name,
    );

    expect(eligible).toContain(islandwalker);
    expect(eligible).toContain(fliers[0]);
    expect(eligible).not.toContain(fliers[1]);
    expect(eligible).not.toContain(vanilla);
    expect(eligible).not.toContain(forestwalker);
    expect(
      validateAction(start.state, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: vanilla, defender: 1 }],
      }),
    ).toBe(`${vanilla} cannot attack`);
  });

  it('stays global through controller changes and stacks idempotently across copies', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 0 },
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: VANILLA, controller: 0, summoningSick: false },
      ],
      active: 0,
    });
    const sources = start.state.battlefield.filter(
      (oid) => start.state.objects[oid]?.card.name === STORMTIDE_LEVIATHAN.name,
    );
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const vanilla = oidOf(start.state, VANILLA.name);
    const controlled = withContinuous(start.state, [controlledBy(onlyObject(sources[1] ?? 'missing'), 0)]);

    expect(hasSubtype(controlled, mountain, 'Island')).toBe(true);
    expect(eligibleAttackers(controlled)).not.toContain(vanilla);

    const firstGone = moveObject(beginTrace(controlled), sources[0] ?? 'missing', 'graveyard');
    expect(hasSubtype(firstGone.state, mountain, 'Island')).toBe(true);
    expect(eligibleAttackers(firstGone.state)).not.toContain(vanilla);

    const bothGone = moveObject(firstGone, sources[1] ?? 'missing', 'graveyard');
    expect(hasSubtype(bothGone.state, mountain, 'Island')).toBe(false);
    expect(eligibleAttackers(bothGone.state)).toContain(vanilla);
  });

  it('copies both statics in layer 1 while layer-6 ability loss stops only the later combat rule', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: COPY_BODY, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: VANILLA, controller: 0, summoningSick: false },
      ],
      active: 0,
    });
    const leviathan = oidOf(start.state, STORMTIDE_LEVIATHAN.name);
    const copy = oidOf(start.state, COPY_BODY.name);
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const vanilla = oidOf(start.state, VANILLA.name);
    const copied = withContinuous(start.state, [
      copies(onlyObject(copy), leviathan, { duration: 'whileSubjectRemains' }),
      abilities(onlyObject(leviathan), { removeAll: true }),
    ]);

    expect(hasSubtype(copied, mountain, 'Island')).toBe(true);
    expect(eligibleAttackers(copied)).not.toContain(vanilla);

    const stripped = withContinuous(copied, [abilities(onlyObject(copy), { removeAll: true })]);
    expect(hasSubtype(stripped, mountain, 'Island')).toBe(true);
    expect(eligibleAttackers(stripped)).toContain(vanilla);

    const originalGone = moveObject(beginTrace(copied), leviathan, 'graveyard');
    expect(hasSubtype(originalGone.state, mountain, 'Island')).toBe(true);
    expect(eligibleAttackers(originalGone.state)).not.toContain(vanilla);

    const departed = moveObject(originalGone, copy, 'graveyard');
    const returned = moveObject(departed, copy, 'battlefield', { controller: 1 });
    expect(hasSubtype(returned.state, mountain, 'Island')).toBe(false);
    expect(eligibleAttackers(returned.state)).toContain(vanilla);
  });

  it('applies a later arrival after an older type-setting effect in layer 4', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [[], [STORMTIDE_LEVIATHAN]],
      active: 0,
    });
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const leviathan = handOidOf(start.state, 1, STORMTIDE_LEVIATHAN.name);
    const olderTypeSet = withContinuous({ ...start.state, nextId: 63 }, [
      retype(onlyObject(mountain), { removeAllSubtypes: true, addSubtypes: ['Forest'] }, { ts: 62 }),
    ]);

    const entered = moveObject(beginTrace(olderTypeSet), leviathan, 'battlefield', {
      controller: 1,
    });

    expect(entered.state.objects[leviathan]?.battlefieldTimestamp).toBe(63);
    expect(hasSubtype(entered.state, mountain, 'Mountain')).toBe(false);
    expect(hasSubtype(entered.state, mountain, 'Forest')).toBe(true);
    expect(hasSubtype(entered.state, mountain, 'Island')).toBe(true);
  });

  it('lets a later type-setting effect overwrite an earlier Stormtide addition', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      active: 0,
    });
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const laterTypeSet = withContinuous(start.state, [
      retype(
        onlyObject(mountain),
        { removeAllSubtypes: true, addSubtypes: ['Forest'] },
        { ts: start.state.nextId + 1 },
      ),
    ]);

    expect(hasSubtype(laterTypeSet, mountain, 'Mountain')).toBe(false);
    expect(hasSubtype(laterTypeSet, mountain, 'Forest')).toBe(true);
    expect(hasSubtype(laterTypeSet, mountain, 'Island')).toBe(false);
  });

  it('gives a blinked source a new timestamp after an intervening type-setting effect', () => {
    const start = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      active: 0,
    });
    const leviathan = oidOf(start.state, STORMTIDE_LEVIATHAN.name);
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const laterTypeSet = withContinuous(start.state, [
      retype(
        onlyObject(mountain),
        { removeAllSubtypes: true, addSubtypes: ['Forest'] },
        { ts: start.state.nextId - 1 },
      ),
    ]);
    const firstTimestamp = start.state.objects[leviathan]?.battlefieldTimestamp;
    if (firstTimestamp === undefined) throw new Error('Stormtide entry timestamp was not stored');

    expect(hasSubtype(laterTypeSet, mountain, 'Island')).toBe(false);
    const departed = moveObject(beginTrace(laterTypeSet), leviathan, 'graveyard');
    expect(departed.state.objects[leviathan]?.battlefieldTimestamp).toBeUndefined();
    const returned = moveObject(departed, leviathan, 'battlefield', { controller: 1 });

    expect(returned.state.objects[leviathan]?.battlefieldTimestamp).toBeGreaterThan(firstTimestamp);
    expect(laterTypeSet.objects[leviathan]?.battlefieldTimestamp).toBe(firstTimestamp);
    expect(hasSubtype(returned.state, mountain, 'Forest')).toBe(true);
    expect(hasSubtype(returned.state, mountain, 'Island')).toBe(true);
  });

  it('uses the copying permanent entry timestamp for copied statics', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      hands: [[], [COPY_BODY]],
      graveyards: [[], [STORMTIDE_LEVIATHAN]],
      active: 0,
    });
    const mountain = oidOf(start.state, MOUNTAIN.name);
    const copy = handOidOf(start.state, 1, COPY_BODY.name);
    const original = start.state.players[1].graveyard[0];
    if (original === undefined) throw new Error('Stormtide copy source was not built');
    const olderTypeSet = withContinuous({ ...start.state, nextId: 100 }, [
      retype(onlyObject(mountain), { removeAllSubtypes: true, addSubtypes: ['Forest'] }, { ts: 99 }),
    ]);
    const entered = moveObject(beginTrace(olderTypeSet), copy, 'battlefield', { controller: 1 });
    const copied = withContinuous(entered.state, [
      copies(onlyObject(copy), original, { duration: 'whileSubjectRemains' }),
    ]);

    expect(copied.objects[copy]?.battlefieldTimestamp).toBe(100);
    expect(hasSubtype(copied, mountain, 'Mountain')).toBe(false);
    expect(hasSubtype(copied, mountain, 'Forest')).toBe(true);
    expect(hasSubtype(copied, mountain, 'Island')).toBe(true);
  });

  it('derives deterministic effects without mutating or perturbing the state fingerprint', () => {
    const first = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: FLIER, controller: 0, summoningSick: false },
      ],
      active: 0,
    });
    const second = scenario({
      battlefield: [
        { card: STORMTIDE_LEVIATHAN, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: FLIER, controller: 0, summoningSick: false },
      ],
      active: 0,
    });
    const firstMountain = oidOf(first.state, MOUNTAIN.name);
    const secondMountain = oidOf(second.state, MOUNTAIN.name);
    const before = stateFingerprint(first.state);

    const firstEffects = effectsApplyingTo(first.state, firstMountain).map((effect) => ({
      kind: effect.kind,
      layer: effect.layer,
      source: effect.sourceOid,
      id: effect.id,
    }));
    const secondEffects = effectsApplyingTo(second.state, secondMountain).map((effect) => ({
      kind: effect.kind,
      layer: effect.layer,
      source: effect.sourceOid,
      id: effect.id,
    }));

    expect(firstEffects).toEqual(secondEffects);
    expect(firstEffects).toHaveLength(1);
    expect(eligibleAttackers(first.state)).toEqual(eligibleAttackers(second.state));
    expect(stateFingerprint(first.state)).toBe(before);
    expect(stateFingerprint(second.state)).toBe(before);
  });
});
