/**
 * One-line renderings of the things a frame has to name: permanents, targets
 * and the actions the kernel enumerated.
 *
 * Every rendering carries the object id it refers to. The model answers with an
 * index and never with an id, so the ids are there for a person reading a
 * recorded ruling, and for the model to tell two copies of the same card apart
 * when it explains itself.
 */
import { formatManaCost, renderAbility, renderOracleText } from '@mtg/dsl';
import type { Action, CombatDefender, GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import {
  abilityAt,
  counterCount,
  isCreatureObject,
  powerOf,
  toughnessOf,
  triggerOnStack,
  tryObject,
} from '@mtg/kernel';

/** `Grizzly Bears [o7] 2/2` plus whatever is currently true of it. */
export function describePermanent(state: GameState, oid: ObjectId): string {
  const object = tryObject(state, oid);
  if (object === undefined) return `${oid} (no longer in the game)`;
  const parts: string[] = [`${object.card.name} [${oid}]`];
  if (isCreatureObject(state, oid)) {
    parts.push(`${String(powerOf(state, oid))}/${String(toughnessOf(state, oid))}`);
    if (object.damage > 0) parts.push(`${String(object.damage)} damage marked`);
    if (object.summoningSick) parts.push('summoning sick');
  }
  if (object.card.kind === 'planeswalker') {
    parts.push(`planeswalker with ${String(counterCount(object.counters, 'loyalty'))} loyalty`);
  }
  if (object.tapped) parts.push('tapped');
  const text = renderOracleText(object.card);
  if (text.length > 0) parts.push(`"${text}"`);
  return parts.join(', ');
}

/** A card in hand, from the seat that is allowed to see it. */
export function describeHandCard(state: GameState, oid: ObjectId): string {
  const object = tryObject(state, oid);
  if (object === undefined) return `${oid} (no longer in the game)`;
  const card = object.card;
  const cost = card.kind === 'land' ? '' : ` ${formatManaCost(card.manaCost)}`;
  const text = renderOracleText(card);
  return text.length === 0 ? `${card.name} [${oid}]${cost}` : `${card.name} [${oid}]${cost} — ${text}`;
}

export function describeTarget(state: GameState, target: Target): string {
  switch (target.kind) {
    case 'player':
      return `player ${String(target.player)}`;
    case 'permanent':
      return describePermanent(state, target.oid);
    case 'spell':
      return `the spell ${nameOf(state, target.oid)}`;
  }
}

function describeCombatDefender(state: GameState, defender: CombatDefender): string {
  return typeof defender === 'number' ? describeSeat(defender) : describePermanent(state, defender.oid);
}

/** What choosing this option does, in one line. */
export function describeAction(state: GameState, action: Action): string {
  switch (action.type) {
    case 'passPriority':
      return 'pass priority';
    case 'playLand':
      return `play ${nameOf(state, action.oid)}`;
    case 'castSpell':
      return `cast ${nameOf(state, action.oid)}${describeTargets(state, action.targets)}`;
    case 'activateManaAbility':
      return `tap ${nameOf(state, action.oid)} for {${action.color}}`;
    case 'activateAbility': {
      // The printed line, not "ability 1": a frame that named an index would
      // ask the model to rule on text it was never shown, and the source's own
      // name is what fills the CARDNAME slots inside it.
      const object = tryObject(state, action.oid);
      const ability = abilityAt(state, action.oid, action.abilityIndex);
      const printed =
        object === undefined || ability === undefined
          ? `ability ${String(action.abilityIndex + 1)}`
          : renderAbility(ability, object.card.name);
      return `activate ${nameOf(state, action.oid)} — ${printed}${describeTargets(state, action.targets)}`;
    }
    case 'declareAttackers':
      return action.attackers.length === 0
        ? 'attack with nothing'
        : `attack with ${action.attackers
            .map(
              (attack) => `${nameOf(state, attack.oid)} at ${describeCombatDefender(state, attack.defender)}`,
            )
            .join(', ')}`;
    case 'declareBlockers':
      return action.blocks.length === 0
        ? 'block with nothing'
        : action.blocks
            .map((block) => `${nameOf(state, block.blocker)} blocks ${nameOf(state, block.attacker)}`)
            .join('; ');
    case 'orderBlockers':
      return action.orders
        .map(
          (order) =>
            `damage from ${nameOf(state, order.attacker)} in the order ` +
            order.blockers.map((blocker) => nameOf(state, blocker)).join(' then '),
        )
        .join('; ');
    case 'discard':
      return `discard ${action.oids.map((oid) => nameOf(state, oid)).join(', ')}`;
    case 'mulligan':
      return 'mulligan this opening hand';
    case 'keepHand':
      return action.bottom.length === 0
        ? 'keep this opening hand'
        : `keep this opening hand, putting ${action.bottom
            .map((oid) => nameOf(state, oid))
            .join(', ')} on the bottom`;
    case 'chooseTriggerTargets':
      // The printed line, for the reason `activateAbility` above prints one: a
      // model asked to rule on "aim ab7" has been shown an id and no text.
      return `aim ${describeTriggerOnStack(state, action.oid)}${describeTargets(state, action.targets)}`;
    case 'answerOptionalTrigger':
      return action.accept
        ? `take ${describeTriggerOnStack(state, action.oid)}`
        : `decline ${describeTriggerOnStack(state, action.oid)}`;
    case 'answerMay':
      return action.accept ? `resolve ${nameOf(state, action.oid)}` : `decline ${nameOf(state, action.oid)}`;
    case 'answerUnless':
      return action.pay
        ? `pay the cost and stop ${nameOf(state, action.oid)}`
        : `let ${nameOf(state, action.oid)} resolve`;
    case 'keepLegend':
      return `keep ${nameOf(state, action.oid)} and put the other copies into their owners' graveyards`;
    // CR 701.17a: the sacrificing player's own choice, not the caster's — the
    // frame that reaches this arm is always addressed to the player who is
    // giving something up.
    case 'sacrificePermanent':
      return `sacrifice ${nameOf(state, action.oid)}`;
    case 'scry':
      return `keep ${String(action.top.length)} on top and put ${String(action.bottom.length)} on the bottom`;
    case 'searchLibrary':
      return action.found === null
        ? 'find nothing and shuffle'
        : `take ${nameOf(state, action.found)} out of your library and shuffle`;
    // No "your" and no shuffle, and the two omissions have one cause: the
    // graveyard the card comes out of may be either seat's (`whose: 'each'`),
    // and a public zone is not resealed the way CR 701.19c reseals a library.
    case 'chooseFromGraveyard':
      return action.chosen === null
        ? 'take nothing out of the graveyard'
        : `take ${nameOf(state, action.chosen)} out of the graveyard`;
    case 'chooseDiscards':
      // No "your", where the cleanup discard above says nothing either way.
      // Both are right: that one can only ever name the acting seat's own
      // cards, and this one names an opponent's about half the time, so a
      // possessive here would be wrong on every `chooseDiscard` and the
      // referee's frames are the one place a wrong word becomes a wrong ruling.
      return `discard ${action.oids.map((oid) => nameOf(state, oid)).join(', ')}`;
    case 'concede':
      return 'concede the game';
  }
}

/** A triggered ability on the stack, as its printed line plus its source. */
function describeTriggerOnStack(state: GameState, oid: ObjectId): string {
  const pending = triggerOnStack(state, oid);
  if (pending === null) return `the ability ${oid}`;
  const source = tryObject(state, pending.source);
  const printed =
    source === undefined
      ? `ability ${String(pending.index + 1)}`
      : renderAbility(pending.ability, source.card.name);
  return `${nameOf(state, pending.source)} — ${printed}`;
}

/** Who owes an action, for the frames that have to say so. */
export function describeSeat(player: PlayerId): string {
  return `player ${String(player)}`;
}

function describeTargets(state: GameState, targets: readonly (Target | null)[]): string {
  const named = targets.flatMap((target, index) =>
    target === null ? [] : [`effect ${String(index + 1)} → ${describeTarget(state, target)}`],
  );
  return named.length === 0 ? '' : ` (${named.join(', ')})`;
}

function nameOf(state: GameState, oid: ObjectId): string {
  const object = tryObject(state, oid);
  return object === undefined ? `${oid} (no longer in the game)` : `${object.card.name} [${oid}]`;
}
