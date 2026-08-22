/**
 * Event log → replay records.
 *
 * The kernel's event stream is the only input (plus an end-of-turn state
 * snapshot per turn, which the driver captures when the turn number rolls
 * over). Nothing here re-derives rules: a turn's numbers are counted off the
 * events the reducer already emitted.
 *
 * Attribution rules worth knowing:
 *
 *  - Events before the first `turnBegan` (shuffles, opening hands) are excluded
 *    from both the per-turn records and the per-game totals, matching 17lands'
 *    treatment of the opening hand as separate from `total_cards_drawn`.
 *  - Owner-scoped columns (`cards_drawn`, `lands_played`, `creatures_cast`, …)
 *    only count the turn owner's own actions, as in 17lands. A non-active
 *    player's instant-speed draw still lands in that side's game totals, so no
 *    event is silently dropped.
 *  - A creature death counts as combat when it happens inside a damage step,
 *    which is what distinguishes a bolt from a bad block. `{side}_creatures_
 *    killed_combat` counts creatures *that side lost*, so the two sides of a
 *    trade land in different columns.
 */
import { manaValue } from '@mtg/dsl';
import type { GameEvent, GameState, ObjectId, PlayerId, Step } from '@mtg/kernel';
import type { GameMetadata, SideTotals, SideTurnStats, SimExtras, SimGameLog, TurnRecord } from './schema';
import { emptySideTotals, emptySideTurnStats } from './schema';

const DAMAGE_STEPS = new Set<Step>(['firstStrikeDamage', 'combatDamage']);

function sideOf(player: PlayerId): 'user' | 'oppo' {
  return player === 0 ? 'user' : 'oppo';
}

interface TurnAccumulator {
  turn: number;
  owner: 'user' | 'oppo';
  ownerPlayer: PlayerId;
  cards_drawn: number;
  cards_tutored: number;
  cards_discarded: number;
  lands_played: number;
  creatures_cast: number;
  non_creatures_cast: number;
  attackers: ObjectId[];
  blockedAttackers: Set<ObjectId>;
  blockerCount: number;
  user: SideTurnStats;
  oppo: SideTurnStats;
}

function newAccumulator(turn: number, active: PlayerId): TurnAccumulator {
  return {
    turn,
    owner: sideOf(active),
    ownerPlayer: active,
    cards_drawn: 0,
    cards_tutored: 0,
    cards_discarded: 0,
    lands_played: 0,
    creatures_cast: 0,
    non_creatures_cast: 0,
    attackers: [],
    blockedAttackers: new Set<ObjectId>(),
    blockerCount: 0,
    user: emptySideTurnStats(),
    oppo: emptySideTurnStats(),
  };
}

function countBattlefield(state: GameState, player: PlayerId, kind: 'land' | 'creature' | 'other'): number {
  let count = 0;
  for (const oid of state.battlefield) {
    const object = state.objects[oid];
    if (object === undefined || object.controller !== player) continue;
    const cardKind = object.card.kind;
    const matches =
      kind === 'land'
        ? cardKind === 'land'
        : kind === 'creature'
          ? cardKind === 'creature'
          : cardKind !== 'land' && cardKind !== 'creature';
    if (matches) count += 1;
  }
  return count;
}

function fillEndOfTurn(stats: SideTurnStats, state: GameState, player: PlayerId): SideTurnStats {
  return {
    ...stats,
    eot_cards_in_hand: state.players[player].hand.length,
    eot_lands_in_play: countBattlefield(state, player, 'land'),
    eot_creatures_in_play: countBattlefield(state, player, 'creature'),
    eot_non_creatures_in_play: countBattlefield(state, player, 'other'),
    eot_life: state.players[player].life,
  };
}

function finishTurn(accumulator: TurnAccumulator, eot: GameState): TurnRecord {
  const attacked = accumulator.attackers.length;
  const blocked = accumulator.blockedAttackers.size;
  return {
    turn: accumulator.turn,
    owner: accumulator.owner,
    cards_drawn: accumulator.cards_drawn,
    cards_tutored: accumulator.cards_tutored,
    cards_discarded: accumulator.cards_discarded,
    lands_played: accumulator.lands_played,
    creatures_cast: accumulator.creatures_cast,
    non_creatures_cast: accumulator.non_creatures_cast,
    creatures_attacked: attacked,
    creatures_blocked: blocked,
    creatures_unblocked: Math.max(0, attacked - blocked),
    creatures_blocking: accumulator.blockerCount,
    user: fillEndOfTurn(accumulator.user, eot, 0),
    oppo: fillEndOfTurn(accumulator.oppo, eot, 1),
  };
}

interface Totals {
  user: SideTotals;
  oppo: SideTotals;
}

export interface LogInputs {
  readonly events: readonly GameEvent[];
  readonly finalState: GameState;
  /** State captured as each turn rolled over; the driver fills this. */
  readonly endOfTurnStates: ReadonlyMap<number, GameState>;
  readonly metadata: GameMetadata;
  readonly extras: SimExtras;
}

/** Builds the structured per-turn log for one finished game. */
export function buildGameLog(inputs: LogInputs): SimGameLog {
  const { events, finalState, endOfTurnStates } = inputs;
  const turns: TurnRecord[] = [];
  const totals: Totals = { user: emptySideTotals(), oppo: emptySideTotals() };
  let current: TurnAccumulator | null = null;
  let step: Step = 'untap';

  const close = (): void => {
    if (current === null) return;
    turns.push(finishTurn(current, endOfTurnStates.get(current.turn) ?? finalState));
    current = null;
  };

  for (const event of events) {
    if (event.type === 'turnBegan') {
      close();
      current = newAccumulator(event.turn, event.active);
      continue;
    }
    if (event.type === 'stepBegan') {
      step = event.step;
      continue;
    }
    if (current === null) continue;
    applyEvent(current, totals, event, finalState, step);
  }
  close();

  return { metadata: inputs.metadata, extras: inputs.extras, totals, turns };
}

function applyEvent(
  turn: TurnAccumulator,
  totals: Totals,
  event: GameEvent,
  finalState: GameState,
  step: Step,
): void {
  switch (event.type) {
    case 'cardDrawn': {
      totals[sideOf(event.player)].cards_drawn += 1;
      if (event.player === turn.ownerPlayer) turn.cards_drawn += 1;
      return;
    }
    case 'cardsDiscarded': {
      totals[sideOf(event.player)].cards_discarded += event.oids.length;
      if (event.player === turn.ownerPlayer) turn.cards_discarded += event.oids.length;
      return;
    }
    case 'landPlayed': {
      totals[sideOf(event.player)].lands_played += 1;
      if (event.player === turn.ownerPlayer) turn.lands_played += 1;
      return;
    }
    case 'spellCast': {
      const side = sideOf(event.player);
      const kind = finalState.objects[event.oid]?.card.kind;
      if (kind === 'creature') {
        totals[side].creatures_cast += 1;
        if (event.player === turn.ownerPlayer) turn.creatures_cast += 1;
      } else {
        totals[side].non_creatures_cast += 1;
        if (event.player === turn.ownerPlayer) turn.non_creatures_cast += 1;
      }
      if (kind === 'instant' || kind === 'sorcery') {
        totals[side].instants_sorceries_cast += 1;
        turn[side].instants_sorceries_cast += 1;
      }
      return;
    }
    case 'abilityActivated': {
      // 17lands' `abilities` column, and the only event that feeds it. A mana
      // ability emits `manaProduced` and never this, which is the same line
      // 17lands draws: an intrinsic mana ability uses no stack (CR 605.1) and
      // is not an activation anybody counts. The column is per-side per-turn
      // only, so there is no total to keep in step.
      turn[sideOf(event.player)].abilities += 1;
      return;
    }
    case 'abilityTriggered': {
      // Our own `sim_triggers` column, and the only event that feeds it. The
      // seat is the one the event names: whoever controlled the source as it
      // triggered (CR 603.3a), which a death trigger makes distinct from
      // whoever controls the permanent by the time it resolves. Counted here
      // rather than folded into `abilities` because the two say different
      // things — a bot chooses an activation and nobody chooses a trigger.
      turn[sideOf(event.player)].sim_triggers += 1;
      return;
    }
    case 'manaPaid': {
      const spent = manaValue(event.cost);
      totals[sideOf(event.player)].mana_spent += spent;
      turn[sideOf(event.player)].mana_spent += spent;
      return;
    }
    case 'damageDealt': {
      if (!event.combat || event.target.kind !== 'player') return;
      turn[sideOf(event.target.player)].combat_damage_taken += event.amount;
      return;
    }
    case 'permanentDestroyed': {
      const object = finalState.objects[event.oid];
      if (object === undefined || object.card.kind !== 'creature') return;
      const side = sideOf(object.controller);
      if (DAMAGE_STEPS.has(step)) turn[side].creatures_killed_combat += 1;
      else turn[side].creatures_killed_non_combat += 1;
      return;
    }
    case 'attackersDeclared': {
      for (const attack of event.attacks) turn.attackers.push(attack.oid);
      return;
    }
    case 'blockersDeclared': {
      for (const block of event.blocks) {
        turn.blockedAttackers.add(block.attacker);
        turn.blockerCount += block.blockers.length;
      }
      return;
    }
    default:
      return;
  }
}
