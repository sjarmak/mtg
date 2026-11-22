/** Native reducer probes for every clause and negative edge of Jace's Erasure. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  pendingDecision,
  playerOf,
  scenario,
  type GameState,
  type ReduceResult,
  type StackEntry,
} from '@mtg/kernel';
import { creature, ISLAND, sorcery } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

function jacesErasure(): Card {
  return parseCard({
    kind: 'enchantment',
    id: 'm11-059-jaces-erasure-kernel',
    name: "Jace's Erasure",
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 59 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    abilities: [
      {
        kind: 'triggered',
        condition: 'youDrawCard',
        optional: true,
        effects: [{ kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } }],
      },
    ],
  } as unknown as CardInput);
}

function study(count: number): Card {
  return sorcery(`Study ${String(count)}`, [{ kind: 'drawCards', count, target: { kind: 'noTarget' } }], {
    U: 1,
  });
}

function studyThenDestroyErasure(): Card {
  return sorcery(
    'Study Then Disperse',
    [
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } },
    ],
    { U: 1 },
  );
}

function deck(prefix: string, count = 6): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 1, 1));
}

function abilities(state: GameState): readonly StackEntry[] {
  return state.stack.filter((entry) => entry.ability !== null);
}

function passUntilStop(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority' || current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('passUntilStop: no decision or quiet stack');
}

function castStudy(from: ReduceResult, player: 0 | 1, count: number): ReduceResult {
  return apply(from, {
    type: 'castSpell',
    player,
    oid: handOidOf(from.state, player, `Study ${String(count)}`),
    targets: [null],
  });
}

function aimEveryTrigger(from: ReduceResult, target: 0 | 1): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 4; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'triggerTargets') return current;
    current = apply(current, {
      type: 'chooseTriggerTargets',
      player: decision.player,
      oid: decision.oid,
      targets: [{ kind: 'player', player: target }],
    });
  }
  throw new Error('aimEveryTrigger: target questions did not finish');
}

function board(drawer: 0 | 1, count: number): ReduceResult {
  return scenario({
    battlefield: [
      { card: jacesErasure(), controller: 0 },
      { card: ISLAND, controller: drawer },
    ],
    hands: drawer === 0 ? [[study(count)], []] : [[], [study(count)]],
    libraries: [deck('Controller library'), deck('Opponent library')],
    active: drawer,
  });
}

describe("Jace's Erasure draw trigger", () => {
  it('fires for its controller drawing outside the draw step and not for an opponent draw', () => {
    const mine = passUntilStop(castStudy(board(0, 1), 0, 1));
    const source = oidOf(mine.state, "Jace's Erasure");
    expect(
      eventsOfType(mine.events, 'abilityTriggered').filter((event) => event.source === source),
    ).toHaveLength(1);
    expect(pendingDecision(mine.state)?.kind).toBe('triggerTargets');

    const theirs = passUntilStop(castStudy(board(1, 1), 1, 1));
    const theirSource = oidOf(theirs.state, "Jace's Erasure");
    expect(
      eventsOfType(theirs.events, 'abilityTriggered').filter((event) => event.source === theirSource),
    ).toEqual([]);
    expect(abilities(theirs.state)).toEqual([]);
  });

  it('chooses a target, then accepting mills exactly one card from that player', () => {
    const fired = passUntilStop(castStudy(board(0, 1), 0, 1));
    const aimed = aimEveryTrigger(fired, 1);
    const beforeLibrary = playerOf(aimed.state, 1).library.length;
    const beforeGraveyard = playerOf(aimed.state, 1).graveyard.length;
    const offered = passUntilStop(aimed);
    const decision = pendingDecision(offered.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('optional trigger was not offered');
    expect(decision.targets).toEqual([{ kind: 'player', player: 1 }]);

    const accepted = apply(offered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: decision.oid,
      accept: true,
    });
    expect(playerOf(accepted.state, 1).library).toHaveLength(beforeLibrary - 1);
    expect(playerOf(accepted.state, 1).graveyard).toHaveLength(beforeGraveyard + 1);
  });

  it('declining leaves the chosen player library and graveyard unchanged', () => {
    const aimed = aimEveryTrigger(passUntilStop(castStudy(board(0, 1), 0, 1)), 1);
    const beforeLibrary = playerOf(aimed.state, 1).library;
    const beforeGraveyard = playerOf(aimed.state, 1).graveyard;
    const offered = passUntilStop(aimed);
    const decision = pendingDecision(offered.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('optional trigger was not offered');

    const declined = apply(offered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: decision.oid,
      accept: false,
    });
    expect(playerOf(declined.state, 1).library).toEqual(beforeLibrary);
    expect(playerOf(declined.state, 1).graveyard).toEqual(beforeGraveyard);
  });

  it('a two-card draw creates two independently targeted and answered triggers', () => {
    const fired = passUntilStop(castStudy(board(0, 2), 0, 2));
    expect(eventsOfType(fired.events, 'cardDrawn')).toHaveLength(2);
    expect(abilities(fired.state)).toHaveLength(2);
    const aimed = aimEveryTrigger(fired, 1);
    expect(eventsOfType(aimed.events, 'triggerTargetsChosen')).toHaveLength(2);
    const before = playerOf(aimed.state, 1).library.length;

    const firstOffered = passUntilStop(aimed);
    const first = pendingDecision(firstOffered.state);
    if (first?.kind !== 'optionalTrigger') throw new Error('first optional trigger was not offered');
    const firstDone = apply(firstOffered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: first.oid,
      accept: false,
    });
    expect(abilities(firstDone.state)).toHaveLength(1);

    const secondOffered = passUntilStop(firstDone);
    const second = pendingDecision(secondOffered.state);
    if (second?.kind !== 'optionalTrigger') throw new Error('second optional trigger was not offered');
    const secondDone = apply(secondOffered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: second.oid,
      accept: true,
    });
    expect(playerOf(secondDone.state, 1).library).toHaveLength(before - 1);
    expect(eventsOfType(secondDone.events, 'triggerDeclined')).toHaveLength(1);
    expect(eventsOfType(secondDone.events, 'cardsMilled')).toHaveLength(1);
  });

  it('still fires when a later instruction of the resolving spell removes its source', () => {
    const spell = studyThenDestroyErasure();
    const opened = scenario({
      battlefield: [
        { card: jacesErasure(), controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[spell], []],
      libraries: [deck('Controller library'), deck('Opponent library')],
      active: 0,
    });
    const source = oidOf(opened.state, "Jace's Erasure");
    const cast = apply(opened, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, spell.name),
      targets: [null, { kind: 'permanent', oid: source }],
    });
    const fired = passUntilStop(cast);

    expect(fired.state.objects[source]?.zone).toBe('graveyard');
    expect(
      eventsOfType(fired.events, 'abilityTriggered').filter((event) => event.source === source),
    ).toHaveLength(1);
    expect(pendingDecision(fired.state)?.kind).toBe('triggerTargets');
  });
});
