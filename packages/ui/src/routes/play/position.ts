/**
 * Live kernel state to board props.
 *
 * The replay viewer's `frame.ts` does this for a recorded snapshot. This is the
 * same mapping against a real `GameState`, and it decides nothing about the
 * game: it reads state and returns what to draw. Every question of legality is
 * answered by the kernel's enumerated options over in `prompt.ts`.
 *
 * The one real difference from replay is hidden information. A replay shows
 * both hands face up on purpose, because the point of watching a bot game is
 * seeing what it was holding. A live game must not: the opponent's hand exists
 * only as its public count in the seat pod, and their library is never revealed.
 * A viewer built by generalizing the replay mapper would have leaked both.
 *
 * Sizes come from `powerOf` and `toughnessOf` rather than from the printed
 * card, so a creature altered by a CR 613 effect reads as what it currently is.
 * That is the face itself and nothing else now: a rail panel used to list one
 * sentence per altered creature, and it was written when it was the only place
 * the derived pair appeared, with the table still printing 1/3 on a creature
 * the kernel fought combat with at 3/3. The face carries both numbers today, so
 * the panel had become a strip of rail restating the board, and it is gone
 * (2026-08-13).
 *
 * Which left the opposite gap, and `gainedKeywords` and `attachedToKey` close
 * it. A derived value that reads as its own printed value is a different lie
 * from a printed value that reads as itself: a 3/3 on the table said nothing
 * about being a 1/3 holding a weapon, and the weapon was another card in the
 * row. So this projection reports what the layer system changed and which
 * permanent it is attached to, and `../../board/Battlefield.ts` draws the pair
 * as one object and the changed value as changed.
 *
 * The same shape of gap, one zone over: the stack said what it was aimed at in
 * words and the board said nothing at all, so two permanents with one name were
 * one sentence under both of them (`mtg-njrp`). `aimedAt` is the projection's
 * answer — the relationship read off `state.stack` once for the whole table,
 * handed to both rows as `BoardPermanent.targetedBy` and to the stack as
 * `StackItem.onBoard`. It draws and does not decide: nothing here judges whether
 * a target is still legal, only whether the permanent is on the battlefield for
 * a mark to sit on.
 */
import type { Card } from '@mtg/dsl';
import { KEYWORD_PRINT_NAMES } from '@mtg/dsl';
import type { GameState, ObjectId, PlayerId, Target } from '@mtg/kernel';
import {
  attachmentOf,
  characteristicsOf,
  counterCount,
  hasKeyword,
  isCreatureObject,
  isGameOver,
  powerOf,
  toughnessOf,
} from '@mtg/kernel';
import { seatPossessive } from '../../seat';
import { attachmentNames, describeTarget, nameOf, ownedName } from './naming';
import type { BoardPermanent, TargetedBy } from '../../board/Battlefield';
import type { CardArt } from '../../card/ArtSlot';
import type { BoardProps, BoardSide } from '../../board/Board';
import type { ExileCard } from '../../board/Exile';
import type { GraveyardCard } from '../../board/Graveyard';
import type { HandCard } from '../../board/Hand';
import type { ManaPoolView, PlayerStatusProps } from '../../board/PlayerStatus';
import type { StackItem } from '../../board/StackZone';
import type { ArtResolver } from '../../lab/art-manifest';
import { artCopies } from './art-copies';

/**
 * How a table finds a card's illustration, when the set it is playing has one.
 *
 * A parameter rather than a lookup, because this module is the mapping from
 * kernel state to board props and knows nothing about where a page got its art.
 * Absent resolves everything to the labeled pending frame, which is the honest
 * state of a set whose art has not been generated.
 *
 * This wire is `ui/board-face`'s find (7737dbd) and the rejected attempt's most
 * useful one: `permanentProps` hardcoded `art: null`, so the play route had
 * never threaded art to any face at all. The hatch on the table was not a
 * missing-art state, it was a missing wire.
 */
export type PositionArt = ArtResolver | null;

/**
 * How a seat's projection asks for a picture: by card and by which copy of it
 * this object is.
 *
 * A closure rather than passing the map down every function, because the copy
 * numbers are one fact about the whole state and the three zones that draw faces
 * each want the same answer for the same object. `art-copies.ts` says how the
 * number is arrived at and why it never moves.
 */
type ArtOf = (oid: ObjectId, card: Card) => CardArt | null;

function artLookup(state: GameState, artFor: PositionArt): ArtOf {
  if (artFor === null) return () => null;
  const copies = artCopies(state);
  return (oid, card) => artFor(card, copies.get(oid) ?? 0);
}

/**
 * What to call each seat, indexed by `PlayerId`.
 *
 * Seat-indexed rather than viewer-relative (`{ you, opponent }`) because the
 * viewer moves. With two people at one screen the seat being asked changes hands
 * every decision, and a relative scheme would have renamed both players every
 * time the question crossed the table.
 */
export type SeatNames = readonly [string, string];

/**
 * How many slots the rail draws for a hand the viewer can see.
 *
 * The opening hand, so a hand at its normal maximum fills the rail exactly and a
 * hand below it shows what it is missing rather than reflowing the surface every
 * time a card is cast. Read off the kernel's own setup config rather than typed
 * here, because a scenario that deals a different opening hand should get a rail
 * that matches it.
 */
export function handSlots(state: GameState): number {
  return state.config.openingHandSize;
}

function cardOf(state: GameState, oid: ObjectId): Card | null {
  return state.objects[oid]?.card ?? null;
}

// What a permanent is called is `naming.ts`'s, and re-exported here because
// this is where every caller already imports it from. One derivation, one
// place: the rail, the stack zone and the staged cast all read the same phrase,
// so a target cannot be `Emberflow Raider` on one surface and `Bot's Emberflow
// Raider` on the next.
export { describeTarget, nameOf } from './naming';

/**
 * What combat this permanent is in, as the sentences a screen reader gets.
 *
 * The board draws combat by position now — an attacker is in the seam and not in
 * its row (`../../board/CombatZone.ts`) — and a position is not readable, so the
 * projection has to hand over the words the badge used to carry. It reads three
 * facts off `state.combat` and invents none of them: whether this object is
 * attacking, whom it was declared against (CR 508.1a), and what has been
 * assigned to block it (CR 509.1a). The mirror is the last field, for a blocker
 * that stayed in its row.
 *
 * Every creature it names is said as its controller's — `Bot's Windrider Drake`
 * — which is `naming.ts`'s standing rule and load-bearing twice over here: the
 * two creatures in a block are always on opposite sides of the table, and the
 * whole point of the sentence is telling a reader which side is which when the
 * drawing that says so is a position they cannot see.
 *
 * The three sentences are absent rather than empty on a permanent that is not in
 * combat, so a caller spreading this onto a board permanent adds nothing to a
 * creature standing in its own row.
 */
interface CombatFacts {
  readonly attacking: boolean;
  readonly blocking: boolean;
  readonly attackingDefender?: string;
  readonly blockedBy?: readonly string[];
  readonly blockingAttacker?: string;
}

function combatFacts(state: GameState, oid: ObjectId, names: SeatNames): CombatFacts {
  const attack = state.combat.attacks.find((one) => one.oid === oid);
  const blockedBy = state.combat.blocks
    .filter((block) => block.attacker === oid)
    .flatMap((block) => block.blockers.map((blocker) => ownedName(state, names, blocker)));
  const blocking = state.combat.blocks.find((block) => block.blockers.includes(oid));
  return {
    attacking: attack !== undefined,
    blocking: blocking !== undefined,
    ...(attack === undefined
      ? {}
      : {
          attackingDefender:
            typeof attack.defender === 'number'
              ? names[attack.defender]
              : ownedName(state, names, attack.defender.oid),
        }),
    ...(blockedBy.length === 0 ? {} : { blockedBy }),
    ...(blocking === undefined ? {} : { blockingAttacker: ownedName(state, names, blocking.attacker) }),
  };
}

/**
 * The keywords the permanent has now that its card does not print, in printed
 * English.
 *
 * The other half of `stats`, and it exists for the same reason. A creature's
 * size already reaches the face as the layer system's answer rather than the
 * card's, so an equipped 1/3 reads 3/3; a creature a weapon granted flying to
 * read exactly like one that had never been equipped, because the only place a
 * keyword is printed on a board face is the rules box, and a board face has
 * none. `characteristicsOf` is layer 6's output (`@mtg/kernel`, `layers.ts`),
 * so a counter's grant and a weapon's grant both arrive here and a "loses all
 * abilities" effect takes them both away again.
 *
 * Printed names rather than the DSL's identifiers, because the board draws
 * these words: the keyword whose identifier is one word and whose printed form
 * is two is the one that would have shipped a badge nobody says out loud.
 */
function gainedKeywords(state: GameState, oid: ObjectId, card: Card): readonly string[] {
  const printed = new Set<string>(card.keywords);
  return characteristicsOf(state, oid)
    .keywords.filter((keyword) => !printed.has(keyword))
    .map((keyword) => KEYWORD_PRINT_NAMES[keyword]);
}

/**
 * What every object on the stack is aimed at, keyed by the permanent it is
 * aimed at.
 *
 * One walk of the stack for the whole table, for `artLookup`'s reason: what is
 * aimed at what is a fact about the state rather than about a seat, and both
 * rows ask the same question of it. A permanent in either seat's row can be the
 * target — `mtg-njrp` is about the *bot's* equip and a hot-seat table has no
 * "your" seat at all — so nothing here filters by controller.
 *
 * `order` counts from the top of the stack, matching what `../../board/
 * StackZone.ts` prints on the entry: the kernel's array is bottom-first, so the
 * last entry is 1 and resolves next. Both ends of the mark are that one number.
 *
 * An entry is listed once per permanent it names however many of its slots name
 * it, because two effects of one spell aimed at one creature are one object
 * waiting on it, and two reticles carrying the same number would be a badge that
 * had counted rather than looked. A target that is a player or a spell on the
 * stack reaches no permanent and appears nowhere here; nor does one whose
 * permanent has left the battlefield, which is CR 608.2b's case and the reason
 * the check is `battlefield` rather than "the object still exists".
 */
function aimedAt(state: GameState, names: SeatNames): ReadonlyMap<ObjectId, readonly TargetedBy[]> {
  const aims = new Map<ObjectId, TargetedBy[]>();
  state.stack.forEach((entry, index) => {
    const order = state.stack.length - index;
    const printed = entry.ability === null ? entry.oid : entry.ability.sourceOid;
    // The entry's controller, not the source permanent's: a triggered ability is
    // controlled by whoever controlled its source when it triggered (CR 603.3d),
    // and it is the entry the stack row names.
    const owner = `${seatPossessive(names[entry.controller])} ${nameOf(state, printed)}`;
    const source = entry.ability === null ? owner : `an ability of ${owner}`;
    const seen = new Set<ObjectId>();
    for (const target of entry.targets) {
      if (target === null || target.kind !== 'permanent') continue;
      if (seen.has(target.oid) || !state.battlefield.includes(target.oid)) continue;
      seen.add(target.oid);
      const held = aims.get(target.oid);
      if (held === undefined) aims.set(target.oid, [{ order, source }]);
      else held.push({ order, source });
    }
  });
  // Top of the stack first, so a permanent two objects are waiting on reads in
  // the order they will happen rather than in the order the array holds them.
  for (const held of aims.values()) held.sort((one, other) => one.order - other.order);
  return aims;
}

function permanentProps(
  state: GameState,
  oid: ObjectId,
  names: SeatNames,
  artOf: ArtOf,
  aims: ReadonlyMap<ObjectId, readonly TargetedBy[]>,
): BoardPermanent | null {
  const object = state.objects[oid];
  if (object === undefined) return null;
  // The board's counter mark is a single net number, so the two counter kinds
  // that change P/T are shown as their sum rather than one of them silently.
  const counters = object.counters.plusOnePlusOne - object.counters.minusOneMinusOne;
  // The size the layer system reports, not the size the card was printed at.
  // A creature holding the Moonblade is 3/3 and its card says 1/3, and the
  // face draws the first, because that is the number combat uses. The printed
  // pair is not dropped: `../../board/Battlefield.ts` puts it in the corner as
  // the derived mark, struck through and named, which is the only place it
  // appears now that the rail's sizes panel is gone.
  const host = attachmentOf(state, oid);
  const attachments = attachmentNames(state, oid);
  const gained = gainedKeywords(state, oid, object.card);
  const targetedBy = aims.get(oid) ?? [];
  return {
    key: String(oid),
    card: object.card,
    tapped: object.tapped,
    // The board's mark reads "this has to wait", so what it reports is the
    // restriction and not the flag. Haste leaves the flag set and lifts both
    // restrictions it imposes (CR 702.10b, 702.10c), so a hasted creature that
    // the kernel will happily send to combat used to sit on the table wearing a
    // label saying it could not go. `replay/frame.ts` keeps reporting the raw
    // flag on purpose: that projection feeds a recorded log, not a player.
    summoningSick: object.summoningSick && isCreatureObject(state, oid) && !hasKeyword(state, oid, 'haste'),
    damage: object.damage,
    counters,
    ...(object.card.kind === 'planeswalker' ? { loyalty: counterCount(object.counters, 'loyalty') } : {}),
    ...combatFacts(state, oid, names),
    art: artOf(oid, object.card),
    ...(isCreatureObject(state, oid)
      ? { stats: { power: powerOf(state, oid), toughness: toughnessOf(state, oid) } }
      : {}),
    // The host twice, by name and by key. The name is the sentence a foot line
    // and a group label are written out of; the key is what lets the row lay
    // the pair out side by side, and a name cannot do that job — two copies of
    // one creature are two hosts with one name, and the row would have tucked
    // both weapons under whichever it met first.
    ...(host === undefined ? {} : { attachedTo: nameOf(state, host), attachedToKey: String(host) }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(gained.length === 0 ? {} : { gainedKeywords: gained }),
    ...(targetedBy.length === 0 ? {} : { targetedBy }),
  };
}

function manaView(state: GameState, player: PlayerId): ManaPoolView {
  return state.players[player].pool;
}

/**
 * The seat whose row physically holds a permanent.
 *
 * A battlefield is one shared zone, but the table divides it into two visual
 * rows. Ordinary permanents follow their controller. An attachment follows its
 * host instead, because putting the two cards together is the only unambiguous
 * picture of the relationship; `controlledBy` preserves the exceptional case
 * where the card beside the host belongs to the other seat.
 */
function displaySeatOf(state: GameState, oid: ObjectId): PlayerId | undefined {
  const object = state.objects[oid];
  if (object === undefined) return undefined;
  const host = attachmentOf(state, oid);
  return host === undefined ? object.controller : (state.objects[host]?.controller ?? object.controller);
}

/** The controller as a phrase that follows "controlled by". */
function controllerVoice(names: SeatNames, player: PlayerId): string {
  return names[player] === 'You' ? 'you' : names[player];
}

/**
 * One seat. `reveal` is false for the opponent in a live game, which replaces
 * their hand with a face-down count and their graveyard stays public because it
 * always is.
 */
function seatSide(
  state: GameState,
  seat: PlayerId,
  viewer: PlayerId,
  names: SeatNames,
  artOf: ArtOf,
  aims: ReadonlyMap<ObjectId, readonly TargetedBy[]>,
): BoardSide {
  const player = state.players[seat];
  const label = names[seat];
  // Every zone this seat owns is named as *theirs*, which is the possessive slot
  // and not a label slot: a region called `You battlefield` is what a screen
  // reader reads out, and `test/play/seat-voice.test.ts` found all four of them
  // (status, battlefield, hand, graveyard) on its first run. `your battlefield`
  // and `Player one's battlefield` are the same rule the rail says a target
  // with, and the visible header is uppercased, so nothing on screen moves.
  const owns = seatPossessive(label);
  const reveal = seat === viewer;
  // `state.turn` names the active player and the priority holder for as long as
  // the kernel keeps a `GameState` around, including after `state.result` is
  // set — the position is the last real turn the game reached, not a cleared
  // one. Once it is over, neither fact is still true of anyone: nobody is
  // taking a turn and nobody has a window to spend (`mtg-a1d6`), so both flags
  // are forced off here rather than trusted from a turn that will never resume.
  const over = isGameOver(state);
  const status: PlayerStatusProps = {
    name: label,
    life: player.life,
    handCount: player.hand.length,
    libraryCount: player.library.length,
    graveyardCount: player.graveyard.length,
    active: !over && state.turn.active === seat,
    priority: !over && state.turn.priority === seat,
    mana: manaView(state, seat),
  };
  const controlledCount = state.battlefield.filter((oid) => state.objects[oid]?.controller === seat).length;
  const permanents = state.battlefield
    .filter((oid) => displaySeatOf(state, oid) === seat)
    .map((oid) => {
      const permanent = permanentProps(state, oid, names, artOf, aims);
      const controller = state.objects[oid]?.controller;
      return permanent === null || controller === undefined || controller === seat
        ? permanent
        : { ...permanent, controlledBy: controllerVoice(names, controller) };
    })
    .filter((permanent): permanent is BoardPermanent => permanent !== null);
  // Keys are the object id itself. Object ids are unique for the life of a
  // game, so this is both a stable React key and the handle a caller needs to
  // match a rendered card back to a kernel object without parsing anything.
  const hand: readonly HandCard[] = reveal
    ? player.hand
        .map((oid): HandCard | null => {
          const card = cardOf(state, oid);
          return card === null ? null : { key: oid, card, art: artOf(oid, card) };
        })
        .filter((entry): entry is HandCard => entry !== null)
    : [];
  // The graveyard carries its art for the same reason the hand does: the
  // browser's hover draws the whole card (`../../board/ZoneBrowser.ts`), and a
  // full face with no illustration is the pending frame rather than the card
  // this set actually printed.
  const graveyard: readonly GraveyardCard[] = player.graveyard
    .map((oid): GraveyardCard | null => {
      const card = cardOf(state, oid);
      return card === null ? null : { key: oid, card, art: artOf(oid, card) };
    })
    .filter((entry): entry is GraveyardCard => entry !== null);
  // The kernel keeps ONE exile for the game (`GameState.exile`) rather than one
  // per seat, so whose card an exiled object is has to be derived here, from the
  // object's `owner`. Owner rather than controller: a creature stolen and then
  // exiled is still its owner's card, and it is the owner's zones a card returns
  // to, so filing it under the thief would put it under the seat it will never
  // come back to. Exile is public in this kernel — nothing puts a card there
  // face down — so `reveal` does not gate it any more than it gates a graveyard.
  const exile: readonly ExileCard[] = state.exile
    .map((oid): ExileCard | null => {
      if (state.objects[oid]?.owner !== seat) return null;
      const card = cardOf(state, oid);
      return card === null ? null : { key: oid, card, art: artOf(oid, card) };
    })
    .filter((entry): entry is ExileCard => entry !== null);

  return {
    status,
    battlefield: { label: `${owns} battlefield`, permanents, count: controlledCount },
    // Only the revealed hand gets a rail. The opposing count already lives in
    // the seat pod, so drawing it again as hatched rectangles spends board space
    // without revealing another fact.
    ...(reveal ? { hand: { label: `${owns} hand`, cards: hand, slots: handSlots(state) } } : {}),
    graveyard: { label: `${owns} graveyard`, cards: graveyard },
    // Absent while this seat owns nothing in exile, which is most games: the pod
    // column is tight and an empty strip would cost a row to say nothing.
    // `../../board/Board.ts` argues the optionality.
    ...(exile.length === 0 ? {} : { exile: { label: `${owns} exile`, cards: exile } }),
  };
}

/**
 * Objects waiting to resolve, including the ones with no card.
 *
 * An activated ability on the stack is an object without a card (CR 113.7a), so
 * `state.objects` has nothing under its id and this loop used to drop it: a
 * player who equipped a weapon watched the mana leave, the stack stay empty and
 * nothing else happen until the ability resolved. What can be drawn for it is
 * the permanent it was printed on, which the kernel records on the entry.
 */
/**
 * A note on the one line that reads like a tautology.
 *
 * An entry's target label goes through `describeTarget`, so entry 1 aimed at a
 * twin now reads `→ your Harbor Sentinel (targeted by 1 · 2/2)` — the entry
 * naming its own number. That is deliberate and it is load-bearing exactly where
 * it looks silliest: two entries aimed at two twins print the *same* target line
 * without it, so the qualifier is the only thing separating one row of this list
 * from the next. `naming.ts` is where the rule is argued.
 */
function stackItems(state: GameState, names: SeatNames): readonly StackItem[] {
  const items: StackItem[] = [];
  for (const entry of state.stack) {
    const source = entry.ability === null ? entry.oid : entry.ability.sourceOid;
    const card = cardOf(state, source);
    if (card === null) continue;
    const chosen = entry.targets.filter((target): target is Target => target !== null);
    const targets = chosen.map((target) => describeTarget(state, names, target));
    // The other half of the target mark's condition, read off the same rule
    // `aimedAt` reads: a permanent still on the battlefield is one the board is
    // drawing, and a mark on this entry pairs with a reticle over there.
    const onBoard = chosen.some(
      (target) => target.kind === 'permanent' && state.battlefield.includes(target.oid),
    );
    const base = {
      key: String(entry.oid),
      card,
      controller: names[entry.controller],
      ...(entry.ability === null ? {} : { ability: true }),
      ...(onBoard ? { onBoard } : {}),
    };
    items.push(targets.length === 0 ? base : { ...base, targetLabel: `→ ${targets.join(', ')}` });
  }
  return items;
}

/** The whole table from one seat's point of view. That seat is drawn nearest. */
export function boardPosition(
  state: GameState,
  viewer: PlayerId,
  names: SeatNames,
  artFor: PositionArt = null,
): BoardProps {
  const other: PlayerId = viewer === 0 ? 1 : 0;
  // One lookup for the whole table: the copy numbers are a fact about the state,
  // not about a seat, and a Swamp does not change picture when the viewer does.
  const artOf = artLookup(state, artFor);
  // And one walk of the stack, for the same reason: what is aimed at what is a
  // fact about the state, and both rows draw out of the same answer.
  const aims = aimedAt(state, names);
  return {
    you: seatSide(state, viewer, viewer, names, artOf, aims),
    opponent: seatSide(state, other, viewer, names, artOf, aims),
    stack: { entries: stackItems(state, names) },
  };
}
