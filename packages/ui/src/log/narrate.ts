/**
 * Events, actions and decisions in English, over the kernel's own types.
 *
 * A replay whose detail panel prints JSON is a log viewer, not a replay viewer.
 * Every kernel event gets one sentence here, naming cards and players rather
 * than object ids, because the question this vocabulary exists to answer — why
 * did this game go the way it did — is asked in words.
 *
 * The functions are total: a `LogNames` book always returns something for an
 * id, and the switch over each union is exhaustive, so no branch can fall
 * through to a raw record.
 *
 * # Why this is not in `routes/replay/`
 *
 * It was, and the move is `mtg-bz2` phase 0. There are three event streams in
 * this repository and this renderer was on the wrong one. It took the replay
 * route's zod-parsed `LogEvent`, which is structurally parallel to but nominally
 * distinct from `@mtg/kernel`'s `GameEvent`; a live game log (`mtg-bz2.12`)
 * renders `GameEvent`, and had three ways out. Fork the renderer, which is what
 * `prompt.ts` and `board/Graveyard.ts` both name as the failure they are
 * avoiding — two functions that can disagree. Write a `GameEvent` to `LogEvent`
 * adapter, which is a third derivation of the same union and one more thing to
 * keep level. Or generalize the renderer onto the type the other two are copies
 * of, which is this.
 *
 * It costs nothing to do, because it is already true: `LogEvent`, `LogAction`
 * and `LogResult` are assignable to `GameEvent`, `Action` and `GameResult`, so
 * the replay route hands its parsed records straight in. The reverse is not
 * assignable and does not need to be — the kernel's arrays are `readonly` and
 * zod's are not — which is why this file is typed on the kernel's side of the
 * pair rather than the log's. `test/replay/record.test.ts` already proves the
 * two unions cover each other variant for variant at compile time.
 *
 * # Why the replay route can still not reach the engine
 *
 * `test/replay/record.test.ts` asserts that nothing under `src/routes/replay/`
 * imports `@mtg/kernel` or `@mtg/sim`, so that a view which cannot reach the
 * engine cannot accidentally re-run it. That property is intact: this module
 * imports the kernel's *types* and nothing else, so the import erases and no
 * engine code enters the replay bundle. `test/log/narrate.test.ts` holds that
 * as its own assertion rather than leaving it to inspection.
 */
import { assertNever, COLOR_WORDS, formatManaCost, GRANTABLE_KEYWORD_PRINT_NAMES } from '@mtg/dsl';
import type { Action, Decision, GameEvent, GameResult, PlayerId, Step, Target } from '@mtg/kernel';
import { seatMention, seatOwn, seatPossessive, seatPossessiveLeading, seatVerb } from '../seat';

/**
 * What to call the two players and every object, so a sentence names cards
 * rather than ids.
 *
 * A book rather than a lookup argument, because the answers come from different
 * places on the two surfaces: the replay route builds it from the log's own
 * object table (`routes/replay/narrate.ts`'s `namesFor`), and a live log builds
 * it from the state it is already holding.
 */
export interface LogNames {
  player(id: PlayerId): string;
  /**
   * A permanent or a spell where the sentence is speaking *for* it: the subject
   * of `Gloom Hand untaps.`, the source of `Sandmark Gate Guard deals 2 damage`,
   * the attackers a seat declares. Its printed name and nothing else.
   */
  card(oid: string): string;
  /**
   * The same object where the sentence is pointing *at* it, said as its
   * controller's: `deals 2 combat damage to Player one's Gloom Hand.`
   *
   * `mtg-h9s`. The log had one answer to "what is this object called" while the
   * rail one column to its left had two (`routes/play/naming.ts`), so a board
   * with two Gloom Hands on it read `Player one's Gloom Hand (4/4)` and
   * `Player one's Gloom Hand (4/4 · 2 damage marked)` in the ask column and
   * `Sandmark Gate Guard deals 2 combat damage to Gloom Hand.` in the log.
   *
   * A second method rather than a possessive on `card`, because the split is per
   * slot and not per object: threading the possessive through every mention
   * would print `Player one casts Player one's Skyborn Wingscout.` The rule is the
   * rail's — a target carries the possessive, a source does not — and it is one
   * rule stated in two places because neither module can call the other's
   * version of it (`naming.ts` reads `GameState` through kernel *values*, and
   * this file may import kernel types only).
   *
   * What it deliberately does *not* carry is the rail's twin qualifier
   * (`3/5 · 2 damage marked`). That phrase is read off the board as it stands
   * now, which is the right answer for a decision being made now and a false one
   * in a sentence about turn 3: the log is re-narrated from the finished state
   * on every render, so a historical line would quote a damage mark the
   * permanent picked up six turns later. Two same-named permanents under one
   * controller are therefore still one phrase in the log, which is `mtg-47o`.
   */
  target(oid: string): string;
}

/**
 * The half of the book a sentence about a seat needs, and nothing else.
 *
 * A result or a life total names no card, and a caller that has only two seat
 * labels in hand should not have to invent a card lookup to say who won. Every
 * `LogNames` is one of these, so nothing at a call site changes.
 */
export type SeatBook = Pick<LogNames, 'player'>;

const STEP_WORDS: Readonly<Record<Step, string>> = {
  untap: 'untap',
  upkeep: 'upkeep',
  draw: 'draw',
  precombatMain: 'precombat main',
  beginCombat: 'begin combat',
  declareAttackers: 'declare attackers',
  declareBlockers: 'declare blockers',
  firstStrikeDamage: 'first-strike damage',
  combatDamage: 'combat damage',
  endCombat: 'end of combat',
  postcombatMain: 'postcombat main',
  end: 'end',
  cleanup: 'cleanup',
};

export function stepWords(step: Step): string {
  return STEP_WORDS[step];
}

const MANA_WORDS: Readonly<Record<string, string>> = {
  ...COLOR_WORDS,
  C: 'colorless',
};

function manaWord(color: string): string {
  return MANA_WORDS[color] ?? color;
}

const END_WORDS = {
  lifeZero: 'life reached zero',
  emptyLibrary: 'drew from an empty library',
  concede: 'conceded',
  turnLimit: 'the turn limit was reached',
} as const;

const DESTROY_WORDS = {
  lethalDamage: 'lethal damage',
  deathtouch: 'deathtouch',
  zeroToughness: 'zero toughness',
  destroyEffect: 'a destroy effect',
} as const;

const LIFE_WORDS = {
  damage: 'damage',
  lifelink: 'lifelink',
  gainLife: 'a life-gain effect',
  lifeLoss: 'a life-loss effect',
} as const;

/** CR 603 conditions as the clause a sentence about the source can end with. */
const TRIGGER_WORDS = {
  selfEnters: 'entering the battlefield',
  selfAttacks: 'attacking',
  selfDies: 'dying',
  selfDiesNotSacrificed: 'dying without having been sacrificed',
  controlledCreatureAttacksAlone: 'a controlled creature attacking alone',
  selfDealsCombatDamageToCreature: 'dealing combat damage to a creature',
  beginningOfYourUpkeep: "the beginning of its controller's upkeep",
  beginningOfYourEndStep: "the beginning of its controller's end step",
  beginningOfEndStep: 'the beginning of the end step',
  anotherControlledPermanentEnters: 'another permanent its controller controls entering the battlefield',
  anotherControlledCreatureEnters: 'another creature its controller controls entering the battlefield',
  youCastSpell: 'its controller casting a spell',
  youCastInstantOrSorcery: 'its controller casting an instant or sorcery spell',
  selfDealsCombatDamageToPlayer: 'dealing combat damage to a player',
  selfBlocks: 'blocking',
  selfBlocksOrIsBlockedByGreaterPower: 'meeting a creature with greater power in a block',
  youGainLife: 'its controller gaining life',
  selfEntersOrAttacks: 'entering the battlefield or attacking',
  aPlayerCastsWhiteSpell: 'a player casting a white spell',
  aPlayerCastsBlueSpell: 'a player casting a blue spell',
  aPlayerCastsBlackSpell: 'a player casting a black spell',
  aPlayerCastsRedSpell: 'a player casting a red spell',
  aPlayerCastsGreenSpell: 'a player casting a green spell',
  opponentDealtNoncombatDamage: 'an opponent of its controller being dealt noncombat damage',
  anotherControlledCreatureWithPowerThreeOrGreaterEnters:
    'another creature its controller controls with power 3 or greater entering the battlefield',
} as const;

/*
 * Every seat word this file says comes from `../seat.ts`, which is the one copy
 * of the rule that the label decides. The five functions below only bind that
 * vocabulary to a `SeatBook`, because a seat arrives here as an id and a
 * `routes/play` sentence has the label in hand already; the rule itself is not
 * restated. It lived in this file until `mtg-crv`, which was filed rather than
 * fixed precisely because the sentence that needed `whom` was in another
 * package directory and this was the log viewer.
 */

function verbFor(id: PlayerId, names: SeatBook, third: string, second: string): string {
  return seatVerb(names.player(id), third, second);
}

function acts(id: PlayerId, names: SeatBook, third: string, second: string): string {
  return `${names.player(id)} ${verbFor(id, names, third, second)}`;
}

/** A seat's possessive: `your hand`, `Bot's hand`. */
function whose(id: PlayerId, names: SeatBook): string {
  return seatPossessive(names.player(id));
}

/** The same possessive opening a sentence, where only the pronoun shifts. */
function whoseLeading(id: PlayerId, names: SeatBook): string {
  return seatPossessiveLeading(names.player(id));
}

/** The possessive that refers back to the sentence's own subject. */
function ownFor(id: PlayerId, names: SeatBook): string {
  return seatOwn(names.player(id));
}

/** A seat a sentence points at rather than speaks for: `damage to you`. */
function whom(id: PlayerId, names: SeatBook): string {
  return seatMention(names.player(id));
}

/**
 * `['a', 'b', 'c']` → `'a, b and c'`, and an empty list → `'nothing'`.
 *
 * Exported because the rail's death beat says the same kind of sentence about
 * the same kind of list (`routes/play/rail.ts`), and a second copy of "how this
 * surface joins names" is how two lines about one board start reading
 * differently.
 */
export function listPhrase(parts: readonly string[]): string {
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

export function describeTarget(target: Target | null, names: LogNames): string {
  if (target === null) return 'no target';
  if (target.kind === 'player') return whom(target.player, names);
  return names.target(target.oid);
}

function targetClause(targets: readonly (Target | null)[], names: LogNames): string {
  const named = targets.filter((target): target is Target => target !== null);
  if (named.length === 0) return '';
  return ` targeting ${listPhrase(named.map((target) => describeTarget(target, names)))}`;
}

function chosenXClause(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : ` for X=${String(value)}`;
}

function damageTargetWords(
  target: { kind: 'player'; player: PlayerId } | { kind: 'permanent'; oid: string },
  names: LogNames,
): string {
  return target.kind === 'player' ? whom(target.player, names) : names.target(target.oid);
}

/** One sentence per kernel event, in the order the reducer emitted them. */
export function describeEvent(event: GameEvent, names: LogNames): string {
  switch (event.type) {
    case 'gameStarted':
      return `${acts(event.startingPlayer, names, 'plays', 'play')} first (seed ${event.seed}).`;
    case 'libraryShuffled':
      return `${acts(event.player, names, 'shuffles', 'shuffle')} a ${event.cards}-card library.`;
    case 'cardDrawn':
      return `${acts(event.player, names, 'draws', 'draw')} ${names.card(event.oid)}.`;
    case 'drawFromEmptyLibrary':
      return `${acts(event.player, names, 'tries', 'try')} to draw from an empty library.`;
    case 'turnBegan':
      return `Turn ${event.turn} begins. ${acts(event.active, names, 'is', 'are')} active.`;
    case 'stepBegan':
      return `${stepWords(event.step)} step begins.`;
    case 'stepEnded':
      return `${stepWords(event.step)} step ends.`;
    case 'permanentUntapped':
      return `${names.card(event.oid)} untaps.`;
    case 'untapSkipped':
      return `${names.card(event.oid)} stays tapped and does not untap.`;
    case 'permanentTapped':
      return `${names.card(event.oid)} taps.`;
    case 'summoningSicknessCleared':
      return `${names.card(event.oid)} loses summoning sickness.`;
    case 'priorityGained':
      return `${acts(event.player, names, 'gets', 'get')} priority.`;
    case 'priorityPassed':
      return `${acts(event.player, names, 'passes', 'pass')} priority.`;
    case 'landPlayed':
      return `${acts(event.player, names, 'plays', 'play')} ${names.card(event.oid)}.`;
    case 'manaProduced':
      return `${names.card(event.sourceOid)} makes ${event.amount} ${manaWord(event.color)} mana for ${whom(event.player, names)}.`;
    case 'manaPoolEmptied':
      return event.wasted === 0
        ? `${whoseLeading(event.player, names)} mana pool empties.`
        : `${whoseLeading(event.player, names)} mana pool empties, wasting ${event.wasted}.`;
    case 'manaPaid':
      return `${acts(event.player, names, 'pays', 'pay')} ${formatManaCost(event.cost)}.`;
    case 'spellCast':
      return `${acts(event.player, names, 'casts', 'cast')} ${names.card(event.oid)}${chosenXClause(event.chosenX)}${targetClause(event.targets, names)}.`;
    case 'spellCopied':
      return `${acts(event.player, names, 'copies', 'copy')} ${names.card(event.copiedFrom)}${chosenXClause(event.chosenX)}${targetClause(event.targets, names)}.`;
    case 'abilityActivated':
      return `${acts(event.player, names, 'activates', 'activate')} ${names.card(event.source)} ability ${event.index + 1}${chosenXClause(event.chosenX)}${targetClause(event.targets, names)}.`;
    case 'abilityTriggered':
      return `${names.card(event.source)}'s ability ${event.index + 1} triggers on ${TRIGGER_WORDS[event.condition]}, under ${whose(event.player, names)} control.`;
    case 'triggerTargetsChosen':
      return `${names.card(event.source)}'s triggered ability goes on the stack${targetClause(event.targets, names)}.`;
    case 'triggerDeclined':
      return `${names.card(event.source)}'s controller declines its triggered ability.`;
    case 'triggerRemoved':
      return `${names.card(event.source)}'s triggered ability is removed from the stack: ${event.why}.`;
    case 'spellCountered':
      return `${names.card(event.oid)} is countered by ${names.card(event.by)}.`;
    case 'spellFizzled':
      return `${names.card(event.oid)} fizzles: every target is gone.`;
    case 'spellDeclined':
      return `${acts(event.player, names, 'declines', 'decline')} to resolve ${names.card(event.oid)}.`;
    case 'unlessPaid':
      return `${acts(event.player, names, 'pays', 'pay')} the cost, and ${names.card(event.oid)} does nothing.`;
    case 'resolutionBegan':
      return `${names.card(event.oid)} resolves.`;
    case 'effectSkipped':
      return `${names.card(event.oid)} skips effect ${event.index + 1}: ${event.why}.`;
    case 'zoneChanged':
      return `${names.card(event.oid)} moves from ${event.from} to ${event.to}.`;
    case 'permanentEntered':
      return `${names.card(event.oid)} enters the battlefield under ${whose(event.controller, names)} control.`;
    case 'tokenCreated':
      return `${acts(event.controller, names, 'creates', 'create')} a ${event.name} token.`;
    case 'damageDealt':
      return `${names.card(event.sourceOid)} deals ${event.amount}${event.deathtouch ? ' deathtouch' : ''}${event.combat ? ' combat' : ''} damage to ${damageTargetWords(event.target, names)}.`;
    case 'damagePrevented':
      return `${event.amount} damage from ${names.card(event.sourceOid)} to ${damageTargetWords(event.target, names)} is prevented.`;
    case 'replacementApplied':
      return `A replacement effect rewrote a ${event.event} event.`;
    case 'countersChanged':
      return event.loyalty === undefined
        ? `${names.card(event.oid)} now has ${event.plusOnePlusOne} +1/+1 and ${event.minusOneMinusOne} -1/-1 counters.`
        : `${names.card(event.oid)} now has ${event.loyalty} loyalty counter${event.loyalty === 1 ? '' : 's'}.`;
    case 'lifeChanged':
      return `${
        event.delta < 0
          ? acts(event.player, names, 'loses', 'lose')
          : acts(event.player, names, 'gains', 'gain')
      } ${Math.abs(event.delta)} life to ${event.life} (${LIFE_WORDS[event.reason]}).`;
    // Two sentences, because two layers. A layer-7c record is a delta and
    // "gets +1/+1" is what Magic calls it; a layer-7b record is a set and the
    // same words about it are simply false — Diminish on a 5/5 does not give
    // it +1/+1, it makes its base 1/1. The `layer` field is what the event
    // carries to tell them apart, so the log branches on it rather than on the
    // sign of the numbers, which cannot distinguish `+1/+1` from `base 1/1`.
    case 'continuousEffectAdded':
      return event.layer === '7b'
        ? `${names.card(event.targetOid)} has base power and toughness ${event.power}/${event.toughness} in layer ${event.layer}.`
        : `${names.card(event.targetOid)} gets ${event.power >= 0 ? '+' : ''}${event.power}/${event.toughness >= 0 ? '+' : ''}${event.toughness} in layer ${event.layer}.`;
    case 'keywordGranted':
      return `${names.card(event.targetOid)} gains ${GRANTABLE_KEYWORD_PRINT_NAMES[event.keyword]} in layer ${event.layer}.`;
    case 'continuousEffectsExpired':
      return `${event.ids.length} continuous effect${event.ids.length === 1 ? '' : 's'} expire.`;
    case 'permanentDestroyed':
      return `${names.card(event.oid)} is destroyed by ${DESTROY_WORDS[event.reason]}.`;
    case 'permanentSacrificed':
      return `${acts(event.player, names, 'sacrifices', 'sacrifice')} ${names.card(event.oid)}.`;
    case 'permanentRegenerated':
      return `${names.card(event.oid)} regenerates.`;
    case 'attackersDeclared':
      return event.attacks.length === 0
        ? `${acts(event.player, names, 'attacks', 'attack')} with nothing.`
        : `${acts(event.player, names, 'attacks', 'attack')} with ${listPhrase(
            event.attacks.map(
              (attack) =>
                `${names.card(attack.oid)} at ${
                  typeof attack.defender === 'number'
                    ? whom(attack.defender, names)
                    : names.target(attack.defender.oid)
                }`,
            ),
          )}.`;
    case 'blockersDeclared':
      return event.blocks.length === 0
        ? `${acts(event.player, names, 'blocks', 'block')} with nothing.`
        : // The attacker is the other seat's and the blockers are this one's, so
          // the possessive falls on exactly the half the sentence is pointing at.
          `${acts(event.player, names, 'blocks', 'block')} ${listPhrase(event.blocks.map((block) => `${names.target(block.attacker)} with ${listPhrase(block.blockers.map((oid) => names.card(oid)))}`))}.`;
    case 'blockerOrderChosen':
      return `${names.card(event.attacker)} assigns damage to ${listPhrase(event.blockers.map((oid) => names.target(oid)))} in that order.`;
    case 'combatDamageStep':
      return event.firstStrike ? 'First-strike combat damage is dealt.' : 'Combat damage is dealt.';
    case 'cardsMilled':
      return `${acts(event.player, names, 'mills', 'mill')} ${listPhrase(event.oids.map((oid) => names.card(oid)))}.`;
    case 'cardsScried':
      return `${acts(event.player, names, 'scries', 'scry')} ${event.count}, putting ${event.bottom} on the bottom.`;
    case 'cardsDiscarded':
      return `${acts(event.player, names, 'discards', 'discard')} ${listPhrase(event.oids.map((oid) => names.card(oid)))}.`;
    case 'handRevealed':
      return event.oids.length === 0
        ? `${acts(event.player, names, 'reveals', 'reveal')} an empty hand.`
        : `${acts(event.player, names, 'reveals', 'reveal')} ${listPhrase(event.oids.map((oid) => names.card(oid)))}.`;
    case 'libraryTopRevealed':
      return `${acts(event.player, names, 'reveals', 'reveal')} ${listPhrase(
        event.oids.map((oid) => names.card(oid)),
      )} off the top of ${ownFor(event.player, names)} library.`;
    // Named cards where `librarySearched` below has none, and the difference is
    // the card's own clause: this event exists only because the card said
    // "reveal", so printing the names is the effect rather than a leak.
    case 'librarySearchRevealed':
      return `${acts(event.player, names, 'reveals', 'reveal')} ${listPhrase(
        event.oids.map((oid) => names.card(oid)),
      )} from ${ownFor(event.player, names)} library.`;
    case 'librarySearched':
      // No card name, because the event carries none: what a search found is
      // announced by the move that follows it when it becomes public, and is
      // never announced when it does not. A line that named the card here would
      // be the narrator leaking what the kernel deliberately did not log.
      return event.found
        ? `${acts(event.player, names, 'searches', 'search')} ${ownFor(event.player, names)} library and ${verbFor(
            event.player,
            names,
            'finds',
            'find',
          )} a card.`
        : `${acts(event.player, names, 'searches', 'search')} ${ownFor(event.player, names)} library and ${verbFor(
            event.player,
            names,
            'finds',
            'find',
          )} nothing.`;
    case 'handMulliganed':
      return `${acts(event.player, names, 'shuffles', 'shuffle')} ${ownFor(event.player, names)} opening hand back and ${verbFor(
        event.player,
        names,
        'draws',
        'draw',
      )} a new one (mulligan ${event.mulligans}).`;
    case 'handKept':
      return event.bottomed.length === 0
        ? `${acts(event.player, names, 'keeps', 'keep')} ${ownFor(event.player, names)} opening hand.`
        : `${acts(event.player, names, 'keeps', 'keep')}, putting ${listPhrase(
            event.bottomed.map((oid) => names.card(oid)),
          )} on the bottom of ${ownFor(event.player, names)} library.`;
    case 'damageCleared':
      return `Marked damage wears off at the end of turn ${event.turn}.`;
    case 'playerLost':
      return `${acts(event.player, names, 'loses', 'lose')} the game: ${END_WORDS[event.reason]}.`;
    case 'gameEnded':
      return event.winner === null
        ? `The game is a draw on turn ${event.turn}: ${END_WORDS[event.reason]}.`
        : `${acts(event.winner, names, 'wins', 'win')} on turn ${event.turn}: ${END_WORDS[event.reason]}.`;
    default:
      return assertNever(event, 'describeEvent');
  }
}

/** One phrase per action, written as the choice the player or bot made. */
export function describeAction(action: Action, names: LogNames): string {
  switch (action.type) {
    case 'passPriority':
      return 'pass priority';
    case 'playLand':
      return `play ${names.card(action.oid)}`;
    case 'castSpell':
      return `cast ${names.card(action.oid)}${chosenXClause(action.x)}${targetClause(action.targets, names)}`;
    case 'activateManaAbility':
      return `tap ${names.card(action.oid)} for ${manaWord(action.color)}`;
    case 'activateAbility':
      // The index rather than the printed line: a viewer holds a card
      // dictionary, not a renderer, and a log that re-derived oracle text
      // would be a second printer that can disagree with the card face.
      return `activate ${names.card(action.oid)} ability ${action.abilityIndex + 1}${targetClause(action.targets, names)}`;
    case 'declareAttackers':
      return action.attackers.length === 0
        ? 'attack with nothing'
        : `attack with ${listPhrase(
            action.attackers.map(
              (attack) =>
                `${names.card(attack.oid)} at ${
                  typeof attack.defender === 'number'
                    ? whom(attack.defender, names)
                    : names.target(attack.defender.oid)
                }`,
            ),
          )}`;
    case 'declareBlockers':
      return action.blocks.length === 0
        ? 'block with nothing'
        : `block ${listPhrase(action.blocks.map((block) => `${names.target(block.attacker)} with ${names.card(block.blocker)}`))}`;
    case 'orderBlockers':
      return `order blockers ${listPhrase(action.orders.map((order) => `${names.card(order.attacker)}: ${listPhrase(order.blockers.map((oid) => names.target(oid)))}`))}`;
    case 'discard':
    case 'chooseDiscards':
      // One line for two actions, which the arms above never share, and it is
      // right here for the reason it would be wrong in the referee's frames:
      // this is a *log* line, read after the fact beside the seat that took the
      // move, and "player 1 discards Shock" says the same true thing whichever
      // seat chose it. Who chose is already in the line's subject.
      return `discard ${listPhrase(action.oids.map((oid) => names.card(oid)))}`;
    case 'mulligan':
      return 'mulligan this hand';
    case 'keepHand':
      return action.bottom.length === 0
        ? 'keep this hand'
        : `keep this hand, bottoming ${listPhrase(action.bottom.map((oid) => names.card(oid)))}`;
    case 'chooseTriggerTargets':
      return `aim ${names.card(action.oid)}${targetClause(action.targets, names)}`;
    case 'answerOptionalTrigger':
      return action.accept ? `take ${names.card(action.oid)}` : `decline ${names.card(action.oid)}`;
    case 'answerMay':
      return action.accept ? `resolve ${names.card(action.oid)}` : `decline ${names.card(action.oid)}`;
    case 'answerUnless':
      return action.pay ? `pay to stop ${names.card(action.oid)}` : `let ${names.card(action.oid)} resolve`;
    case 'keepLegend':
      // Every option under this decision names the same card, so this line is
      // one `optionLabels` always disambiguates by object id. That is right: the
      // id is the only thing separating two copies in a record that holds no
      // board.
      return `keep ${names.card(action.oid)}`;
    // CR 701.17a: the log names the creature that left, not the caster who
    // made it happen — the seat in the subject is the one who chose.
    case 'sacrificePermanent':
      return `sacrifice ${names.card(action.oid)}`;
    case 'scry':
      return `keep ${String(action.top.length)} on top and put ${String(action.bottom.length)} on the bottom`;
    case 'searchLibrary':
      return action.found === null ? 'find nothing' : `take ${names.card(action.found)}`;
    // "take nothing", where the search above says "find nothing": failing to
    // find is CR 701.19c's licensed answer to a hidden zone, and a graveyard
    // is public, so declining here is a decision anybody watching could have
    // predicted rather than a fact the searcher alone knows.
    case 'chooseFromGraveyard':
      return action.chosen === null ? 'take nothing' : `take ${names.card(action.chosen)}`;
    case 'concede':
      return 'concede';
    default:
      return assertNever(action, 'describeAction');
  }
}

function actionOid(action: Action): string | null {
  switch (action.type) {
    case 'playLand':
    case 'castSpell':
    case 'activateManaAbility':
    case 'activateAbility':
    case 'keepLegend':
    case 'sacrificePermanent':
      return action.oid;
    default:
      return null;
  }
}

/**
 * Option labels for one decision, disambiguated.
 *
 * Two untapped Plains produce two identical "tap Plains for white" options, and
 * a list that prints the same line twice hides the fact that the kernel offered
 * a real choice between distinct objects. Duplicates get their object id.
 */
export function optionLabels(options: readonly Action[], names: LogNames): readonly string[] {
  const labels = options.map((option) => describeAction(option, names));
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return labels.map((label, index) => {
    if ((counts.get(label) ?? 0) < 2) return label;
    const option = options[index];
    const oid = option === undefined ? null : actionOid(option);
    return `${label} (${oid ?? `option ${index + 1}`})`;
  });
}

/**
 * The questions the kernel can ask, read off `Decision` rather than listed
 * again, so a tenth kind fails to compile here instead of narrating as
 * `undefined`.
 */
export type DecisionKind = Decision['kind'];

const DECISION_QUESTIONS: Readonly<Record<DecisionKind, string>> = {
  mulligan: 'decides whether to keep their opening hand',
  priority: 'holds priority and may act',
  declareAttackers: 'declares attackers',
  declareBlockers: 'declares blockers',
  orderBlockers: 'orders blockers for damage assignment',
  discard: 'discards down to hand size',
  triggerTargets: 'chooses targets for a triggered ability',
  optionalTrigger: 'decides whether to take an optional triggered ability',
  may: 'decides whether to resolve a spell whose effect is optional',
  unless: 'decides whether to pay the cost a spell aimed at them printed',
  legendRule: 'chooses which of their same-named legendary permanents to keep',
  scry: 'orders the cards they looked at while scrying',
  searchLibrary: 'chooses which card to take out of their library, or to find nothing',
  // "a graveyard", not "their graveyard": the effect may read either seat's,
  // and a log line that named the wrong one would be read by the seat that
  // just lost the card.
  graveyardChoice: 'chooses which card to take out of a graveyard, or to take none',
  // Deliberately not "discards down to hand size", which is what `discard`
  // above says: this one is a resolving effect's discard and the seat asked is
  // not always the seat losing the cards. One sentence covers both readings by
  // naming the choice rather than the loss.
  handDiscard: 'chooses which cards a resolving effect discards',
  // Deliberately "their own creatures", not "a creature": CR 701.17a fixes
  // this choice with the permanent's controller, unlike `handDiscard`, whose
  // asked seat is sometimes choosing about somebody else's hand.
  permanentSacrifice: 'chooses which of their own creatures a resolving effect sacrifices',
};

/**
 * The question the kernel asked, as a sentence.
 *
 * It takes the two members it reads rather than a whole `Decision`, so the same
 * function serves the replay route's parsed record and a live `Decision`
 * without either one having to be converted into the other.
 */
export function describeDecision(
  decision: { readonly kind: DecisionKind; readonly player: PlayerId },
  names: LogNames,
): string {
  return `${names.player(decision.player)} ${DECISION_QUESTIONS[decision.kind]}.`;
}

/** How the game finished, for the header badge and the last step. */
export function describeResult(result: GameResult, names: SeatBook): string {
  if (result.winner === null) {
    return `Draw on turn ${result.endedOnTurn}: ${END_WORDS[result.reason]}.`;
  }
  return `${acts(result.winner, names, 'wins', 'win')} on turn ${result.endedOnTurn}: ${END_WORDS[result.reason]}.`;
}
