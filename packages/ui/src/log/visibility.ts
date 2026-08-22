/**
 * Who is entitled to read the card names in a log line.
 *
 * The play surface draws the board from the seat being asked (`routes/play/
 * use-session.ts`'s `seatOnDeck`), and `routes/play/position.ts` already hides
 * the other hand behind a face-down count. A game log is the second way that
 * hiding can fail, and it fails the same way: silently. `describeEvent` names
 * cards, `cardDrawn` carries the drawn object's id, and `state.objects` holds
 * every card in the game — so a log rendered without this module prints "Player
 * two draws Lightning Bolt" on a screen player one is holding.
 *
 * # The rule is the kernel's zones, not a list of event names
 *
 * A card's identity is public exactly when it has been in a public zone. CR 400.2
 * splits the six: the library and the hand are hidden zones, the battlefield, the
 * graveyard, the exile and the stack are public. So:
 *
 *  - `cardDrawn` moves library to hand — hidden to hidden, private to its player.
 *  - `handKept`'s `bottomed` moves hand to library — hidden to hidden, private.
 *  - `zoneChanged` is judged off its own two endpoints, which is what makes the
 *    rule a rule rather than a habit: a discard (hand to graveyard) and a mill
 *    (library to graveyard) both end in a public zone and are public records,
 *    and the bottoming half of a mulligan is neither.
 *  - Everything else names objects that are already on the stack, the
 *    battlefield or in a graveyard, or names no object at all.
 *
 * `cardsDiscarded` and `cardsMilled` are public for that reason and not by
 * exception: both put the named cards face up in a graveyard, and hiding them
 * would be hiding something both players can see by opening the zone browser.
 *
 * `handRevealed` is the one member that is public *against* the zone rule rather
 * than because of it: the cards are still in a hand, and showing them is the
 * whole effect (CR 701.16a). Redacting it would print "target opponent reveals
 * their hand" and then name nothing, which is a log that reports a spell doing
 * exactly nothing. The reveal is a moment, not a lasting property — nothing
 * downstream keeps it, and the next line about those same cards is private
 * again.
 *
 * # Why the whole union is switched over
 *
 * `privateTo` is exhaustive and `assertNever` closes it, so a forty-ninth event
 * member added to the kernel tomorrow fails to compile here rather than defaulting
 * to public and leaking on the first game that emits it. That is the entire
 * reason this is a switch and not a set of event names to check against.
 *
 * # Why redaction happens in the names book
 *
 * `LogNames.card` is the one seam every card name in every sentence passes
 * through (`./narrate.ts`). Redacting there rather than inside `describeEvent`
 * means the narration stays one function shared with the replay route — which
 * shows both hands face up on purpose, because watching a recorded bot game is
 * the point — and no sentence has to be written twice. `./group.ts` is where the
 * two are joined.
 */
import { assertNever } from '@mtg/dsl';
import type { GameEvent, PlayerId, ZoneId } from '@mtg/kernel';
import type { LogNames } from './narrate';

/** What a card the viewer may not identify is called. */
export const HIDDEN_CARD = 'a card';

/** CR 400.2: the zones whose contents are not revealed to both players. */
const HIDDEN_ZONES: readonly ZoneId[] = ['library', 'hand'];

function isHidden(zone: ZoneId): boolean {
  return HIDDEN_ZONES.includes(zone);
}

/**
 * The seat that owns this event's private knowledge, or `null` when the event
 * names nothing a player could be entitled to withhold.
 *
 * A seat rather than a boolean because the answer is relative: the same
 * `cardDrawn` is a card its own player may read and a card the other player may
 * not, and with two people at one screen the viewer changes every decision.
 *
 * Counts are never private. `libraryShuffled` reports a library size, a hand
 * size is on the opposing status line already, and hiding a number both players
 * can count on the table would be theater rather than concealment.
 */
export function privateTo(event: GameEvent): PlayerId | null {
  switch (event.type) {
    case 'cardDrawn':
      return event.player;
    case 'handKept':
      // The bottomed cards went hand to library, both hidden. An empty `bottomed`
      // names nothing, and answering the same way for it costs nothing: the
      // sentence it produces has no card in it either way.
      return event.player;
    case 'zoneChanged':
      return isHidden(event.from) && isHidden(event.to) ? event.owner : null;
    case 'gameStarted':
    case 'libraryShuffled':
    case 'drawFromEmptyLibrary':
    case 'turnBegan':
    case 'stepBegan':
    case 'stepEnded':
    case 'permanentUntapped':
    case 'permanentTapped':
    case 'untapSkipped':
    case 'summoningSicknessCleared':
    case 'priorityGained':
    case 'priorityPassed':
    case 'landPlayed':
    case 'manaProduced':
    case 'manaPoolEmptied':
    case 'manaPaid':
    case 'spellCast':
    case 'spellCopied':
    case 'abilityActivated':
    case 'abilityTriggered':
    case 'triggerTargetsChosen':
    case 'triggerDeclined':
    case 'triggerRemoved':
    case 'spellCountered':
    case 'spellFizzled':
    case 'spellDeclined':
    case 'unlessPaid':
    case 'resolutionBegan':
    case 'effectSkipped':
    case 'permanentEntered':
    case 'tokenCreated':
    case 'damageDealt':
    case 'damagePrevented':
    case 'replacementApplied':
    case 'countersChanged':
    case 'lifeChanged':
    case 'continuousEffectAdded':
    case 'keywordGranted':
    case 'continuousEffectsExpired':
    case 'permanentDestroyed':
    case 'permanentSacrificed':
    case 'permanentRegenerated':
    case 'attackersDeclared':
    case 'blockersDeclared':
    case 'blockerOrderChosen':
    case 'combatDamageStep':
    case 'cardsMilled':
    case 'cardsScried':
    case 'cardsDiscarded':
    case 'handRevealed':
    case 'handMulliganed':
    case 'damageCleared':
    case 'playerLost':
    case 'gameEnded':
    case 'libraryTopRevealed':
    case 'librarySearched':
    case 'librarySearchRevealed':
      // The last three are the library block's public half. A reveal shows its
      // cards to every player (CR 701.16a), which makes it the one effect that
      // tells a seat something about its own deck, and a search event carries a
      // boolean and no card name at all. A search's reveal is the first of those
      // again at CR 701.19's own reveal clause: the card printed "reveal it", so
      // the names are what the clause bought. The comment sits under the labels
      // rather than above them because a comment between two `case`s is a case
      // body to `no-fallthrough`, and an empty one is what the rule reports.
      return null;
    default:
      return assertNever(event, 'privateTo');
  }
}

/** Whether this viewer may read the card names this event carries. */
export function namesVisibleTo(event: GameEvent, viewer: PlayerId): boolean {
  const owner = privateTo(event);
  return owner === null || owner === viewer;
}

/**
 * The same book with every card name replaced and every player name intact.
 *
 * Seat names are not secret — the opposing status line prints one — and a
 * sentence that hid them would say who drew nothing at all.
 */
export function redacted(names: LogNames): LogNames {
  // Both card slots, and the same word in each: a possessive on a name this
  // seat may not read would say whose the hidden card is, which is half of what
  // the redaction is hiding.
  return { player: names.player, card: (): string => HIDDEN_CARD, target: (): string => HIDDEN_CARD };
}

/** The book this event may be narrated with, from this seat. */
export function namesFor(event: GameEvent, viewer: PlayerId, names: LogNames): LogNames {
  return namesVisibleTo(event, viewer) ? names : redacted(names);
}
