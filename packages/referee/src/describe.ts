/**
 * One-line renderings of the things a frame has to name: permanents, targets
 * and the actions the kernel enumerated.
 *
 * Every rendering carries the object id it refers to. The model answers with an
 * index and never with an id, so the ids are there for a person reading a
 * recorded ruling, and for the model to tell two copies of the same card apart
 * when it explains itself.
 */
import { assertNever, formatManaCost, renderAbility, renderOracleText } from '@mtg/dsl';
import type {
  Action,
  CastingCostChoice,
  CombatDefender,
  GameState,
  ObjectId,
  PlayerId,
  Target,
} from '@mtg/kernel';
import {
  copiableValuesOf,
  counterCount,
  currentAbilityAt,
  isCreatureObject,
  powerOf,
  spellCardByOid,
  toughnessOf,
  triggerOnStack,
  tryObject,
} from '@mtg/kernel';

/** `Grizzly Bears [o7] 2/2` plus whatever is currently true of it. */
export function describePermanent(state: GameState, oid: ObjectId): string {
  const object = tryObject(state, oid);
  if (object === undefined) return `${oid} (no longer in the game)`;
  const card = copiableValuesOf(state, oid);
  const parts: string[] = [`${card.name} [${oid}]`];
  if (isCreatureObject(state, oid)) {
    parts.push(`${String(powerOf(state, oid))}/${String(toughnessOf(state, oid))}`);
    if (object.damage > 0) parts.push(`${String(object.damage)} damage marked`);
    if (object.summoningSick) parts.push('summoning sick');
  }
  if (card.kind === 'planeswalker') {
    parts.push(`planeswalker with ${String(counterCount(object.counters, 'loyalty'))} loyalty`);
  }
  if (card.kind === 'battle') {
    parts.push(
      `Battle with ${String(counterCount(object.counters, 'defense'))} defense, protected by player ${String(object.protector ?? object.controller)}`,
    );
  }
  if (object.tapped) parts.push('tapped');
  const text = renderOracleText(card);
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
    case 'card':
      return `the card ${nameOf(state, target.oid)}`;
    case 'spell':
      return `the spell ${nameOf(state, target.oid)}`;
  }
}

function describeCombatDefender(state: GameState, defender: CombatDefender): string {
  return typeof defender === 'number' ? describeSeat(defender) : describePermanent(state, defender.oid);
}

/** The announced casting profile, kept exhaustive with the kernel union. */
function describeCastingCost(castingCost: CastingCostChoice | undefined): string {
  if (castingCost === undefined) return '';
  switch (castingCost) {
    case 'mana':
      return ' using its printed mana cost';
    case 'alternative':
      return ' using its alternative cost';
    case 'overload':
      return ' using its overload cost';
    case 'withoutMana':
      return ' using no mana payment';
    default:
      return assertNever(castingCost, 'referee casting-cost description');
  }
}

/** What choosing this option does, in one line. */
export function describeAction(state: GameState, action: Action): string {
  switch (action.type) {
    case 'passPriority':
      return 'pass priority';
    case 'playLand':
      return `play ${nameOf(state, action.oid)}`;
    case 'castSpell': {
      const cost = describeCastingCost(action.castingCost);
      const paid = action.sacrifices ?? [];
      const sacrifice =
        paid.length === 0 ? '' : ` sacrificing ${paid.map((oid) => nameOf(state, oid)).join(', ')}`;
      return `cast ${nameOf(state, action.oid)}${cost}${sacrifice}${describeTargets(state, action.targets, action.multiTargets, action.damageAllocations)}`;
    }
    case 'beginCastSpell': {
      const cost = describeCastingCost(action.castingCost);
      const paid = action.sacrifices ?? [];
      const sacrifice =
        paid.length === 0 ? '' : ` sacrificing ${paid.map((oid) => nameOf(state, oid)).join(', ')}`;
      return `begin casting ${nameOf(state, action.oid)}${cost}${sacrifice}${describeTargets(state, action.targets)}`;
    }
    case 'choosePluralTarget':
      return action.target === null
        ? `finish choosing targets for ${nameOf(state, action.oid)}`
        : `add ${describeTarget(state, action.target)} as a target for ${nameOf(state, action.oid)}`;
    case 'allocateDividedDamage':
      return `assign ${String(action.amount)} damage for ${nameOf(state, action.oid)}`;
    case 'chooseSpellTargets':
      return `choose new targets for ${nameOf(state, action.oid)}${describeTargets(state, action.targets, action.multiTargets, action.damageAllocations)}`;
    case 'chooseEntryCopy':
      return action.copyOf === null
        ? `have ${nameOf(state, action.oid)} enter normally`
        : `have ${nameOf(state, action.oid)} enter as a copy of ${nameOf(state, action.copyOf)}`;
    case 'chooseEntryCounterPermanent':
      return `put its entry counter on ${nameOf(state, action.permanent)}`;
    case 'chooseEntryAuraHost':
      return `have ${nameOf(state, action.oid)} enter attached to ${nameOf(state, action.host)}`;
    case 'chooseEntryTimestampNext':
      return `give ${nameOf(state, action.oid)} the next timestamp among simultaneous entrants`;
    case 'chooseEntryCharacteristics':
      return `have ${nameOf(state, action.oid)} enter in characteristic mode ${String(action.mode + 1)}`;
    case 'chooseEntryOptionalCounter':
      return action.accept
        ? `have ${nameOf(state, action.oid)} enter with a +1/+1 counter`
        : `have ${nameOf(state, action.oid)} enter without a counter`;
    case 'chooseEntryPayLife': {
      return action.pay
        ? `pay ${String(action.life)} life as ${nameOf(state, action.oid)} enters`
        : `have ${nameOf(state, action.oid)} enter tapped without paying ${String(action.life)} life`;
    }
    case 'chooseEntryPlayer':
      return `choose player ${String(action.chosen)} as ${nameOf(state, action.oid)} enters`;
    case 'chooseEntryColors':
      return `choose ${action.colors.join(' and ')} as ${nameOf(state, action.oid)} enters`;
    case 'allocateDamagePrevention':
      return `prevent ${String(action.amount)} damage from ${nameOf(state, action.sourceOid)}`;
    case 'activateManaAbility':
      return `tap ${nameOf(state, action.oid)} for ${action.amount === undefined ? '' : `${String(action.amount)} `}{${action.color}}`;
    case 'chooseManaColor':
      return `choose {${action.color}} for the resolving mana effect`;
    case 'activateAbility': {
      // The printed line, not "ability 1": a frame that named an index would
      // ask the model to rule on text it was never shown, and the source's own
      // name is what fills the CARDNAME slots inside it.
      const object = tryObject(state, action.oid);
      const ability = currentAbilityAt(state, action.oid, action.abilityIndex);
      const card = object === undefined ? null : copiableValuesOf(state, action.oid);
      const printed =
        card === null || ability === undefined
          ? `ability ${String(action.abilityIndex + 1)}`
          : renderAbility(ability, card.name);
      const chosen =
        action.mode === undefined
          ? printed
          : `${printed.split('\n')[0] ?? printed} ${printed.split('\n')[action.mode + 1] ?? `mode ${String(action.mode + 1)}`}`;
      const tapPayment =
        action.taps === undefined || action.taps.length === 0
          ? ''
          : ` (tap payment → ${action.taps.map((oid) => nameOf(state, oid)).join(', ')})`;
      return `activate ${nameOf(state, action.oid)} — ${chosen}${tapPayment}${describeTargets(state, action.targets, action.multiTargets, action.damageAllocations)}`;
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
    case 'orderAttackers':
      return action.orders
        .map(
          (order) =>
            `damage from ${nameOf(state, order.blocker)} in the order ` +
            order.attackers.map((attacker) => nameOf(state, attacker)).join(' then '),
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
    case 'chooseOpeningHandAction':
      return action.oid === null
        ? 'finish opening-hand actions'
        : `begin with ${nameOf(state, action.oid)} on the battlefield`;
    case 'chooseTriggerTargets':
      // The printed line, for the reason `activateAbility` above prints one: a
      // model asked to rule on "aim ab7" has been shown an id and no text.
      return `aim ${describeTriggerOnStack(state, action.oid)}${describeTargets(state, action.targets, action.multiTargets, action.damageAllocations)}`;
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
    case 'declineFreeCast':
      return `leave ${nameOf(state, action.oid)} in exile`;
    case 'keepLegend':
      return `keep ${nameOf(state, action.oid)} and put the other copies into their owners' graveyards`;
    // CR 701.17a: the sacrificing player's own choice, not the caster's — the
    // frame that reaches this arm is always addressed to the player who is
    // giving something up.
    case 'sacrificePermanent':
      return `sacrifice ${nameOf(state, action.oid)}`;
    case 'choosePermanentToUntap':
      return action.oid === null
        ? 'finish choosing permanents to untap'
        : `untap ${nameOf(state, action.oid)}`;
    case 'scry':
      return `keep ${String(action.top.length)} on top and put ${String(action.bottom.length)} on the bottom`;
    case 'orderTopLibrary':
      return `put ${String(action.cards.length)} cards back in order`;
    case 'selectFromTopLibrary':
      return action.chosen === null ? 'take no card and order the rest' : 'take one card and order the rest';
    case 'separateTopLibraryPiles':
      return `separate the cards into piles of ${String(action.first.length)} and ${String(action.second.length)}`;
    case 'chooseTopLibraryPile':
      return `choose pile ${String(action.pile + 1)}`;
    case 'searchLibrary':
      return action.found === null
        ? 'find nothing and shuffle'
        : `take ${nameOf(state, action.found)} out of your library and shuffle`;
    case 'chooseSearchDestination':
      return `assign ${nameOf(state, action.one)} to the search's one-card destination`;
    // No "your" and no shuffle, and the two omissions have one cause: the
    // graveyard the card comes out of may be either seat's (`whose: 'each'`),
    // and a public zone is not resealed the way CR 701.19c reseals a library.
    case 'chooseFromGraveyard':
      return action.chosen === null
        ? 'take nothing out of the graveyard'
        : `take ${nameOf(state, action.chosen)} out of the graveyard`;
    case 'chooseFromBattlefield':
      return `return ${nameOf(state, action.chosen)} to its owner's hand`;
    case 'choosePopulateToken':
      return `create a copy of ${nameOf(state, action.token)}`;
    case 'chooseCardName':
      return `name ${action.name}`;
    case 'chooseNamedZoneExile':
      return action.oid === null
        ? 'finish choosing named cards to exile'
        : `choose ${nameOf(state, action.oid)} to exile`;
    case 'chooseDiscards':
      // No "your", where the cleanup discard above says nothing either way.
      // Both are right: that one can only ever name the acting seat's own
      // cards, and this one names an opponent's about half the time, so a
      // possessive here would be wrong on every `chooseDiscard` and the
      // referee's frames are the one place a wrong word becomes a wrong ruling.
      return `discard ${action.oids.map((oid) => nameOf(state, oid)).join(', ')}`;
    case 'chooseFromRevealedHand':
      return action.chosen === null
        ? 'choose no card from the revealed hand'
        : `choose ${nameOf(state, action.chosen)} from the revealed hand`;
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
      : renderAbility(pending.ability, copiableValuesOf(state, pending.source).name);
  return `${nameOf(state, pending.source)} — ${printed}`;
}

/** Who owes an action, for the frames that have to say so. */
export function describeSeat(player: PlayerId): string {
  return `player ${String(player)}`;
}

function describeTargets(
  state: GameState,
  targets: readonly (Target | null)[],
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
): string {
  const named = targets.flatMap((target, index) =>
    target === null ? [] : [`effect ${String(index + 1)} → ${describeTarget(state, target)}`],
  );
  for (const [slot, choices] of Object.entries(multiTargets ?? {}).sort(
    ([left], [right]) => Number(left) - Number(right),
  )) {
    const index = Number(slot);
    const allocations = damageAllocations?.[index];
    named.push(
      ...choices.map(
        (target, targetIndex) =>
          `effect ${String(index + 1)} → ${describeTarget(state, target)}${
            allocations?.[targetIndex] === undefined ? '' : ` for ${String(allocations[targetIndex])}`
          }`,
      ),
    );
  }
  return named.length === 0 ? '' : ` (${named.join(', ')})`;
}

function nameOf(state: GameState, oid: ObjectId): string {
  const pendingFace = state.pendingFreeCast?.oid === oid ? state.pendingFreeCast.card : undefined;
  const object = tryObject(state, oid);
  const card =
    pendingFace ?? (object === undefined ? spellCardByOid(state, oid) : copiableValuesOf(state, oid));
  return card === null || card === undefined ? `${oid} (no longer in the game)` : `${card.name} [${oid}]`;
}
