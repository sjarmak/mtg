/**
 * Shared test drivers.
 *
 * `playCombat` walks a scenario through the real combat steps — declare, block,
 * order, damage — using only public actions, so combat assertions never poke at
 * internal state to get where they are going.
 */
import type {
  Action,
  BlockDeclaration,
  BlockerOrdering,
  GameState,
  ObjectId,
  ReduceResult,
} from '@mtg/kernel';
import { opponentOf, pendingDecision, reduce } from '@mtg/kernel';

export function apply(current: ReduceResult, action: Action): ReduceResult {
  const step = reduce(current.state, action);
  return { state: step.state, events: [...current.events, ...step.events] };
}

/** The single battlefield object with this card name; throws when ambiguous. */
export function oidOf(state: GameState, name: string): ObjectId {
  const matches = oidsOf(state, name);
  const first = matches[0];
  if (first === undefined) throw new Error(`no battlefield object named ${name}`);
  if (matches.length > 1) throw new Error(`${matches.length} battlefield objects named ${name}`);
  return first;
}

export function oidsOf(state: GameState, name: string): readonly ObjectId[] {
  return state.battlefield.filter((oid) => state.objects[oid]?.card.name === name);
}

export function handOidOf(state: GameState, player: 0 | 1, name: string): ObjectId {
  const oid = state.players[player].hand.find((entry) => state.objects[entry]?.card.name === name);
  if (oid === undefined) throw new Error(`player ${player} has no ${name} in hand`);
  return oid;
}

export function damageOn(state: GameState, oid: ObjectId): number {
  return state.objects[oid]?.damage ?? 0;
}

export function inGraveyard(state: GameState, oid: ObjectId): boolean {
  return state.objects[oid]?.zone === 'graveyard';
}

export interface CombatScript {
  readonly attackers: readonly ObjectId[];
  readonly blocks?: readonly BlockDeclaration[];
  readonly orders?: readonly BlockerOrdering[];
}

/**
 * Declares the given attack and blocks, then passes priority until combat is
 * over (or somebody has lost).
 */
export function playCombat(start: ReduceResult, script: CombatScript): ReduceResult {
  const active = start.state.turn.active;
  const defender = opponentOf(active);
  let current = apply(start, {
    type: 'declareAttackers',
    player: active,
    attackers: script.attackers.map((oid) => ({ oid, defender })),
  });

  for (let guard = 0; guard < 200; guard += 1) {
    if (current.state.result !== null) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) return current;
    switch (decision.kind) {
      case 'declareBlockers':
        current = apply(current, {
          type: 'declareBlockers',
          player: decision.player,
          blocks: script.blocks ?? [],
        });
        break;
      case 'orderBlockers':
        current = apply(current, {
          type: 'orderBlockers',
          player: decision.player,
          orders:
            script.orders ??
            decision.blocks.map((block) => ({ attacker: block.attacker, blockers: block.blockers })),
        });
        break;
      case 'priority':
        if (current.state.turn.step === 'endCombat') return current;
        current = apply(current, { type: 'passPriority', player: decision.player });
        break;
      default:
        throw new Error(`playCombat: unexpected decision ${decision.kind}`);
    }
  }
  throw new Error('playCombat: combat did not finish');
}
