/** Hostile source-zone, controller, subtype, optionality, and incarnation probes for M13 #114. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  canBlock,
  eligibleBlockers,
  eventsOfType,
  moveObject,
  pendingDecision,
  playerOf,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, MOUNTAIN, SWAMP } from './cards';
import { copies, onlyObject, withContinuous } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

const VEILBORN_GHOUL = parseCard({
  kind: 'creature',
  id: 'm13-114-veilborn-ghoul-kernel',
  name: 'Veilborn Ghoul',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 114 },
  colors: ['B'],
  manaCost: { generic: 4, B: 1 },
  subtypes: ['Zombie'],
  power: 4,
  toughness: 1,
  abilities: [
    { kind: 'static', scope: 'self', modification: { kind: 'cantBlock' } },
    {
      kind: 'triggered',
      condition: 'controlledLandSubtypeEnters',
      landSubtype: 'Swamp',
      triggerZone: 'graveyard',
      optional: true,
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
});

const ATTACKER = creature('Veilborn Probe Attacker', 2, 2);
const BLANK_COPY = creature('Veilborn Probe Blank Copy', 2, 2);
const VEILBORN_DECOY = parseCard({
  kind: 'creature',
  id: 'm13-114-veilborn-decoy-kernel',
  name: 'Veilborn Ghoul',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 114 },
  colors: ['B'],
  manaCost: { generic: 4, B: 1 },
  subtypes: ['Zombie'],
  power: 4,
  toughness: 1,
  abilities: [],
});

function graveyardOids(state: GameState, player: 0 | 1): readonly ObjectId[] {
  return playerOf(state, player).graveyard.filter((oid) => state.objects[oid]?.card.id === VEILBORN_GHOUL.id);
}

function playLand(start: ReduceResult, player: 0 | 1, name: string): ReduceResult {
  return apply(start, {
    type: 'playLand',
    player,
    oid: handOidOf(start.state, player, name),
  });
}

function untilOptional(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') {
      throw new Error(`Veilborn trigger met ${decision?.kind ?? 'nothing'} before optional resolution`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Veilborn trigger never reached its optional decision');
}

function answer(start: ReduceResult, accept: boolean): ReduceResult {
  const current = untilOptional(start);
  const decision = pendingDecision(current.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('Veilborn trigger lost its choice');
  return apply(current, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

function fired(result: ReduceResult): number {
  return eventsOfType(result.events, 'abilityTriggered').filter(
    (event) => event.condition === 'controlledLandSubtypeEnters',
  ).length;
}

describe('Veilborn Ghoul graveyard trigger', () => {
  it('fires only for a Swamp entering under the source owner control while the source is in that graveyard', () => {
    const ownSwamp = playLand(
      scenario({ graveyards: [[VEILBORN_GHOUL], []], hands: [[SWAMP], []] }),
      0,
      SWAMP.name,
    );
    expect(fired(ownSwamp)).toBe(1);
    expect(ownSwamp.state.stack).toHaveLength(1);

    const mountain = playLand(
      scenario({ graveyards: [[VEILBORN_GHOUL], []], hands: [[MOUNTAIN], []] }),
      0,
      MOUNTAIN.name,
    );
    expect(fired(mountain)).toBe(0);
    expect(mountain.state.stack).toHaveLength(0);

    const opposingSwamp = playLand(
      scenario({
        graveyards: [[VEILBORN_GHOUL], []],
        hands: [[], [SWAMP]],
        active: 1,
      }),
      1,
      SWAMP.name,
    );
    expect(fired(opposingSwamp)).toBe(0);
    expect(opposingSwamp.state.stack).toHaveLength(0);

    const battlefieldSource = playLand(
      scenario({
        battlefield: [{ card: VEILBORN_GHOUL, controller: 0 }],
        hands: [[SWAMP], []],
      }),
      0,
      SWAMP.name,
    );
    expect(fired(battlefieldSource)).toBe(0);
    expect(battlefieldSource.state.stack).toHaveLength(0);
  });

  it('declines without moving the source and accepts by returning only the exact source', () => {
    const opened = scenario({ graveyards: [[VEILBORN_GHOUL], []], hands: [[SWAMP], []] });
    const source = graveyardOids(opened.state, 0)[0];
    if (source === undefined) throw new Error('fixture lost a graveyard Ghoul');

    const declined = answer(playLand(opened, 0, SWAMP.name), false);
    expect(declined.state.objects[source]?.zone).toBe('graveyard');
    expect(eventsOfType(declined.events, 'triggerDeclined')).toHaveLength(1);

    const acceptedStart = scenario({
      graveyards: [[VEILBORN_GHOUL, VEILBORN_DECOY], []],
      hands: [[SWAMP], []],
    });
    const acceptedSource = graveyardOids(acceptedStart.state, 0)[0];
    const acceptedDecoy = playerOf(acceptedStart.state, 0).graveyard.find(
      (oid) => acceptedStart.state.objects[oid]?.card.id === VEILBORN_DECOY.id,
    );
    if (acceptedSource === undefined || acceptedDecoy === undefined) {
      throw new Error('fixture lost the accepted source or decoy');
    }
    const accepted = answer(playLand(acceptedStart, 0, SWAMP.name), true);
    expect(accepted.state.objects[acceptedSource]?.zone).toBe('hand');
    expect(accepted.state.objects[acceptedDecoy]?.zone).toBe('graveyard');
  });

  it('does nothing when the triggering incarnation departed before resolution', () => {
    const opened = scenario({ graveyards: [[VEILBORN_GHOUL], []], hands: [[SWAMP], []] });
    const source = graveyardOids(opened.state, 0)[0];
    if (source === undefined) throw new Error('fixture lost the departing Ghoul');
    const triggered = playLand(opened, 0, SWAMP.name);
    const departed = moveObject(beginTrace(triggered.state), source, 'hand');
    const returned = moveObject(departed, source, 'graveyard');
    const interrupted = {
      state: returned.state,
      events: [...triggered.events, ...returned.events],
    };

    const resolved = answer(interrupted, true);
    expect(resolved.state.objects[source]?.zone).toBe('graveyard');
  });

  it('discovers graveyard abilities from the new zone rather than battlefield copy values', () => {
    const printedGhoul = scenario({
      battlefield: [
        { card: VEILBORN_GHOUL, controller: 0 },
        { card: BLANK_COPY, controller: 0 },
      ],
      hands: [[SWAMP], []],
    });
    const ghoul = oidOf(printedGhoul.state, VEILBORN_GHOUL.name);
    const blank = oidOf(printedGhoul.state, BLANK_COPY.name);
    const ghoulCopiedAsBlank = withContinuous(printedGhoul.state, [copies(onlyObject(ghoul), blank)]);
    const ghoulInGraveyard = moveObject(beginTrace(ghoulCopiedAsBlank), ghoul, 'graveyard');
    expect(fired(playLand(ghoulInGraveyard, 0, SWAMP.name))).toBe(1);

    const printedBlank = scenario({
      battlefield: [
        { card: VEILBORN_GHOUL, controller: 0 },
        { card: BLANK_COPY, controller: 0 },
      ],
      hands: [[SWAMP], []],
    });
    const source = oidOf(printedBlank.state, VEILBORN_GHOUL.name);
    const copiedBlank = oidOf(printedBlank.state, BLANK_COPY.name);
    const blankCopiedAsGhoul = withContinuous(printedBlank.state, [copies(onlyObject(copiedBlank), source)]);
    const blankInGraveyard = moveObject(beginTrace(blankCopiedAsGhoul), copiedBlank, 'graveyard');
    expect(fired(playLand(blankInGraveyard, 0, SWAMP.name))).toBe(0);
  });
});

describe("Veilborn Ghoul's battlefield restriction", () => {
  it('keeps the creature out of the block declaration while its graveyard trigger is inactive', () => {
    const current = scenario({
      battlefield: [
        { card: VEILBORN_GHOUL, controller: 0 },
        { card: ATTACKER, controller: 1 },
      ],
    });
    const ghoul = oidOf(current.state, VEILBORN_GHOUL.name);
    const attacker = oidOf(current.state, ATTACKER.name);
    expect(eligibleBlockers(current.state)).not.toContain(ghoul);
    expect(canBlock(current.state, ghoul, attacker)).toBe(false);
  });
});
