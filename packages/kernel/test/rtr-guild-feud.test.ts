/** Native targeted two-library creature contest for RTR #97. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  advanceToStep,
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, instant, ISLAND } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const GUILD_FEUD = parseCard({
  kind: 'enchantment',
  id: 'rtr-97-guild-feud-kernel',
  name: 'Guild Feud',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 97 },
  manaCost: { generic: 5, R: 1 },
  colors: ['R'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [],
      guildFeudContest: true,
    },
  ],
} satisfies CardInput);

const OPPONENT_CREATURE = creature('Opponent Champion', 2, 2);
const YOUR_CREATURE = creature('Your Champion', 4, 4);
const OPPONENT_TRIGGER_CREATURE = creature('Opponent Herald', 1, 4, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});
const CONTROLLER_TRIGGER_CREATURE = creature('Controller Herald', 1, 4, {
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});
const SHAPESHIFTER = parseCard({
  kind: 'creature',
  id: 'guild-feud-entry-choice',
  name: 'Choice Champion',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 97 },
  manaCost: { generic: 3 },
  colors: [],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersAsCharacteristicChoice',
    modes: [
      { power: 3, toughness: 3 },
      { power: 1, toughness: 5, addSubtypes: ['Wall'], addKeywordAbilities: [{ kind: 'defender' }] },
    ],
  },
} satisfies CardInput);
const OTHER = instant('Passing Thought', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }]);
const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'guild-feud-target-probe-leyline',
  name: 'Guild Feud Target Probe Leyline',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 98 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
});

function beginContest(
  yours: readonly ReturnType<typeof creature>[] = [YOUR_CREATURE],
  theirs: readonly ReturnType<typeof creature>[] = [OPPONENT_CREATURE],
): ReduceResult {
  const started = scenario({
    active: 1,
    battlefield: [{ card: GUILD_FEUD, controller: 0 }],
    libraries: [
      [...yours, OTHER, ISLAND],
      [...theirs, OTHER, ISLAND],
    ],
  });
  const upkeep = advanceToStep(started, 'upkeep');
  const target = pendingDecision(upkeep.state);
  if (target?.kind !== 'triggerTargets') throw new Error('Guild Feud did not ask for its opponent');
  return apply(upkeep, {
    type: 'chooseTriggerTargets',
    player: target.player,
    oid: target.oid,
    targets: [{ kind: 'player', player: 1 }],
  });
}

function nextSelection(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'topLibrarySelect') return current;
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Guild Feud never reached its top-three choice');
}

function choose(from: ReduceResult, name: string | null): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'topLibrarySelect') throw new Error('Guild Feud selection disappeared');
  const chosen =
    name === null
      ? null
      : (decision.eligible.find((oid) => from.state.objects[oid]?.card.name === name) ?? null);
  if (name !== null && chosen === null) throw new Error(`${name} was not eligible`);
  const action = decision.options.find(
    (option) => option.type === 'selectFromTopLibrary' && option.chosen === chosen,
  );
  if (action?.type !== 'selectFromTopLibrary') throw new Error('Guild Feud choice was not offered');
  return apply(from, action);
}

function zoneNames(result: ReduceResult, zone: readonly ObjectId[]): readonly string[] {
  return zone.map((oid) => result.state.objects[oid]?.card.name ?? 'missing');
}

describe('Guild Feud target and ordered choices', () => {
  it('removes the trigger without asking when the opponent already has hexproof', () => {
    const started = scenario({
      active: 1,
      battlefield: [
        { card: GUILD_FEUD, controller: 0 },
        { card: LEYLINE, controller: 1 },
      ],
      libraries: [
        [YOUR_CREATURE, OTHER, ISLAND],
        [OPPONENT_CREATURE, OTHER, ISLAND],
      ],
    });
    const upkeep = advanceToStep(started, 'upkeep');
    expect(pendingDecision(upkeep.state)).not.toMatchObject({ kind: 'triggerTargets' });
    expect(upkeep.state.stack).toHaveLength(0);
    expect(eventsOfType(upkeep.events, 'triggerRemoved').map((event) => event.why)).toEqual([
      'no legal targets',
    ]);
    expect(eventsOfType(upkeep.events, 'libraryTopRevealed')).toEqual([]);
  });

  it('targets the opponent, lets them choose first, then asks the controller', () => {
    const first = nextSelection(beginContest());
    const opponentChoice = pendingDecision(first.state);
    expect(opponentChoice).toMatchObject({ kind: 'topLibrarySelect', player: 1 });
    const second = choose(first, OPPONENT_CREATURE.name);
    expect(pendingDecision(second.state)).toMatchObject({ kind: 'topLibrarySelect', player: 0 });
    expect(eventsOfType(second.events, 'libraryTopRevealed')).toHaveLength(2);
  });

  it('fizzles when the targeted opponent gains hexproof before resolution', () => {
    const started = scenario({
      active: 1,
      battlefield: [{ card: GUILD_FEUD, controller: 0 }],
      hands: [[], [LEYLINE]],
      libraries: [
        [YOUR_CREATURE, OTHER, ISLAND],
        [OPPONENT_CREATURE, OTHER, ISLAND],
      ],
    });
    const upkeep = advanceToStep(started, 'upkeep');
    const target = pendingDecision(upkeep.state);
    if (target?.kind !== 'triggerTargets') throw new Error('Guild Feud did not ask for its opponent');
    const aimed = apply(upkeep, {
      type: 'chooseTriggerTargets',
      player: target.player,
      oid: target.oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    const protectedOpponent = moveObject(
      beginTrace(aimed.state),
      handOidOf(aimed.state, 1, LEYLINE.name),
      'battlefield',
      { controller: 1 },
    );
    let resolved: ReduceResult = { state: protectedOpponent.state, events: protectedOpponent.events };
    for (let guard = 0; guard < 4; guard += 1) {
      const decision = pendingDecision(resolved.state);
      if (decision?.kind !== 'priority') break;
      resolved = apply(resolved, { type: 'passPriority', player: decision.player });
      if (resolved.state.stack.length === 0) break;
    }
    expect(pendingDecision(resolved.state)).not.toMatchObject({ kind: 'topLibrarySelect' });
    expect(resolved.state.players[0].library).toEqual(aimed.state.players[0].library);
    expect(resolved.state.players[1].library).toEqual(aimed.state.players[1].library);
  });
});

describe('Guild Feud resolution', () => {
  it('puts both selected creatures onto the battlefield, bins each remainder, then makes them fight', () => {
    const first = nextSelection(beginContest());
    const firstDecision = pendingDecision(first.state);
    if (firstDecision?.kind !== 'topLibrarySelect') throw new Error('opponent choice disappeared');
    const opponentOid = firstDecision.eligible.find(
      (oid) => first.state.objects[oid]?.card.name === OPPONENT_CREATURE.name,
    );
    if (opponentOid === undefined) throw new Error('opponent creature was not eligible');
    const second = choose(first, OPPONENT_CREATURE.name);
    const done = choose(second, YOUR_CREATURE.name);
    expect(done.state.objects[oidOf(done.state, YOUR_CREATURE.name)]).toMatchObject({
      zone: 'battlefield',
      damage: 2,
    });
    expect(done.state.objects[opponentOid]?.zone).toBe('graveyard');
    expect(zoneNames(done, done.state.players[0].graveyard)).toEqual([OTHER.name, ISLAND.name]);
    expect(zoneNames(done, done.state.players[1].graveyard)).toEqual([
      OTHER.name,
      ISLAND.name,
      OPPONENT_CREATURE.name,
    ]);
  });

  it('allows either player to decline and fights only when exactly two creatures entered this way', () => {
    const first = nextSelection(beginContest());
    const second = choose(first, null);
    const done = choose(second, YOUR_CREATURE.name);
    expect(done.state.objects[oidOf(done.state, YOUR_CREATURE.name)]).toMatchObject({
      zone: 'battlefield',
      damage: 0,
    });
    expect(done.state.players[1].graveyard).toHaveLength(3);
  });

  it('reveals and bins only the cards available when a library has fewer than three', () => {
    const first = nextSelection(beginContest([], []));
    const second = choose(first, null);
    const done = choose(second, null);
    expect(done.state.players[0].library).toEqual([]);
    expect(done.state.players[1].library).toEqual([]);
    expect(done.state.players[0].graveyard).toHaveLength(2);
    expect(done.state.players[1].graveyard).toHaveLength(2);
  });

  it('finishes the first creature as-entry choice before moving that library remainder or asking you', () => {
    const first = nextSelection(beginContest([YOUR_CREATURE], [SHAPESHIFTER]));
    const entering = choose(first, SHAPESHIFTER.name);
    const entryChoice = pendingDecision(entering.state);
    expect(entryChoice).toMatchObject({ kind: 'entryCharacteristics', player: 1 });
    expect(entering.state.players[1].graveyard).toEqual([]);
    const mode = entryChoice?.options.find(
      (option) => option.type === 'chooseEntryCharacteristics' && option.mode === 0,
    );
    if (mode?.type !== 'chooseEntryCharacteristics') throw new Error('entry mode was not offered');
    const second = apply(entering, mode);
    expect(second.state.objects[oidOf(second.state, SHAPESHIFTER.name)]).toMatchObject({
      zone: 'battlefield',
    });
    expect(second.state.players[1].graveyard).toHaveLength(2);
    expect(pendingDecision(second.state)).toMatchObject({ kind: 'topLibrarySelect', player: 0 });
  });

  it("defers both creatures' entry triggers until the entire contest and fight finish", () => {
    const first = nextSelection(beginContest([CONTROLLER_TRIGGER_CREATURE], [OPPONENT_TRIGGER_CREATURE]));
    const second = choose(first, OPPONENT_TRIGGER_CREATURE.name);
    expect(second.state.stack).toHaveLength(0);
    const done = choose(second, CONTROLLER_TRIGGER_CREATURE.name);
    expect(done.state.players.map((player) => player.life)).toEqual([20, 20]);
    expect(done.state.stack).toHaveLength(2);
    expect(pendingDecision(done.state)).toMatchObject({ kind: 'priority' });
  });
});
