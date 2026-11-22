/**
 * Snapshot to board props.
 *
 * Nothing here decides anything about the game — it maps one recorded frame
 * onto `@mtg/ui`'s board primitives. Seat 0 is drawn nearest the viewer because
 * the sim log calls seat 0 `user`, and keeping the two surfaces agreeing on
 * which seat is "you" is worth more than a viewer-chosen perspective.
 *
 * Hands are drawn face up. This is a post-hoc replay of a bot game, and the
 * whole reason to watch one is to see what a bot was holding when it made a
 * decision that looks wrong.
 *
 * **And the faces carry illustrations** (`mtg-6hrz`). They did not: every card
 * this file built said `art: null`, so the Replay tab drew the labeled pending
 * frame on every tile of every board however much art the set had. That is the
 * same missing wire `../play/position.ts` records finding on the played table —
 * "The hatch on the table was not a missing-art state, it was a missing wire" —
 * and this is the other end of it.
 *
 * Which illustration a permanent draws is its *copy number*, and a replay may
 * not compute that a second way: it is how many objects of that card the kernel
 * created before this one, and a replay has to paint the board its game painted.
 * The log records the kernel's own object table (`log-schema.ts`'s `objects`,
 * read into `ReplayGameLog.objects`), which is `GameState.objects` written down,
 * so `../play/art-copies.ts`'s `copyNumbers` is handed that table and returns
 * the same numbers the live board got. One function, two object tables.
 */
import type { Card } from '@mtg/dsl';
import { isCreature } from '@mtg/dsl';
import type { BoardProps, BoardSide } from '../../board/Board';
import type { BoardPermanent } from '../../board/Battlefield';
import type { ExileCard } from '../../board/Exile';
import type { GraveyardCard } from '../../board/Graveyard';
import type { HandCard } from '../../board/Hand';
import type { ManaPoolView, PlayerStatusProps } from '../../board/PlayerStatus';
import type { StackItem } from '../../board/StackZone';
import { stackModeLabel } from '../../board/stack-mode';
import type { CardArt } from '../../card/ArtSlot';
import { copyNumbers } from '../play/art-copies';
import type { PositionArt } from '../play/position';
import { seatPossessive } from '../../seat';
import type { LogBoardPermanent, LogPlayerId, LogSnapshot } from './log-schema';
import { describeTarget } from './narrate';
import type { ReplayNames } from './narrate';
import type { ReplayGameLog } from './read-log';

function cardOf(game: ReplayGameLog, oid: string): Card | null {
  return game.objects.get(oid)?.card ?? null;
}

/**
 * How this frame asks for a picture: by object, because the copy number is a
 * fact about the object rather than about the card.
 *
 * The same closure shape `../play/position.ts` uses, and for the same reason:
 * the copy numbers are one fact about the whole log and the three zones that
 * draw faces each want the same answer for the same object.
 */
type ArtOf = (oid: string, card: Card) => CardArt | null;

function artLookup(game: ReplayGameLog, artFor: PositionArt): ArtOf {
  if (artFor === null) return () => null;
  const copies = copyNumbers([...game.objects].map(([oid, object]) => ({ oid, cardId: object.card.id })));
  return (oid, card) => artFor(card, copies.get(oid) ?? 0);
}

interface Keyed<T> {
  readonly key: string;
  readonly card: T;
  readonly art: CardArt | null;
}

function keyedCards(
  game: ReplayGameLog,
  oids: readonly string[],
  prefix: string,
  artOf: ArtOf,
): readonly Keyed<Card>[] {
  const out: Keyed<Card>[] = [];
  for (const [index, oid] of oids.entries()) {
    const card = cardOf(game, oid);
    if (card !== null) out.push({ key: `${prefix}-${index}-${oid}`, card, art: artOf(oid, card) });
  }
  return out;
}

/**
 * The names of the permanents this frame shows attached to one host.
 *
 * Read out of the same snapshot the host came from rather than carried on the
 * host, because the log records the attachment once, on the attached permanent
 * (`log-schema.ts` says why). `position.ts` inverts the live state the same way.
 */
function attachmentNames(
  game: ReplayGameLog,
  snapshot: LogSnapshot,
  host: string,
  names: ReplayNames,
): readonly string[] {
  return snapshot.battlefield
    .filter((permanent) => permanent.attachedTo === host && cardOf(game, permanent.oid) !== null)
    .map((permanent) => names.card(permanent.oid));
}

function permanentProps(
  game: ReplayGameLog,
  snapshot: LogSnapshot,
  permanent: LogBoardPermanent,
  names: ReplayNames,
  artOf: ArtOf,
): BoardPermanent | null {
  const card = permanent.copiedCard ?? cardOf(game, permanent.oid);
  if (card === null) return null;
  const { power, toughness, attachedTo } = permanent;
  const attachments = attachmentNames(game, snapshot, permanent.oid, names);
  return {
    key: permanent.oid,
    card,
    tapped: permanent.tapped,
    summoningSick: permanent.summoningSick,
    damage: permanent.damage,
    counters: permanent.plusCounters,
    ...(card.kind === 'planeswalker' ? { loyalty: permanent.loyalty ?? 0 } : {}),
    ...(card.kind === 'battle'
      ? {
          defense: permanent.defense ?? 0,
          ...(permanent.protector === undefined ? {} : { protector: permanent.protector }),
        }
      : {}),
    attacking: permanent.attacking,
    blocking: permanent.blocking,
    ...(permanent.detained === true ? { detained: true } : {}),
    art: artOf(permanent.oid, card),
    // The recorded pair is already the derived one, so the face prints what the
    // layer system said at that step rather than what the card was printed at.
    ...(power === null || toughness === null ? {} : { stats: { power, toughness } }),
    ...(attachedTo === null ? {} : { attachedTo: names.card(attachedTo), attachedToKey: attachedTo }),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

/**
 * The row that displays a recorded permanent. Attachments follow their host so
 * a replay preserves the same table hierarchy as live play, while the snapshot
 * remains the authority for who controls each object.
 */
function displaySeatOf(snapshot: LogSnapshot, permanent: LogBoardPermanent): LogPlayerId {
  if (permanent.attachedTo === null) return permanent.controller;
  return (
    snapshot.battlefield.find((candidate) => candidate.oid === permanent.attachedTo)?.controller ??
    permanent.controller
  );
}

function seatSide(
  game: ReplayGameLog,
  snapshot: LogSnapshot,
  seat: LogPlayerId,
  active: LogPlayerId,
  priority: LogPlayerId | null,
  names: ReplayNames,
  artOf: ArtOf,
): BoardSide {
  const state = snapshot.seats[seat];
  const label = names.player(seat);
  const pool: ManaPoolView = state.pool;
  const status: PlayerStatusProps = {
    name: label,
    life: state.life,
    handCount: state.hand.length,
    libraryCount: state.library,
    graveyardCount: state.graveyard.length,
    active: seat === active,
    priority: priority === seat,
    mana: pool,
  };
  const controlledCount = snapshot.battlefield.filter((permanent) => permanent.controller === seat).length;
  const permanents = snapshot.battlefield
    .filter((permanent) => displaySeatOf(snapshot, permanent) === seat)
    .map((permanent) => {
      const projected = permanentProps(game, snapshot, permanent, names, artOf);
      return projected === null || permanent.controller === seat
        ? projected
        : { ...projected, controlledBy: names.player(permanent.controller) };
    })
    .filter((permanent): permanent is BoardPermanent => permanent !== null);
  const hand: readonly HandCard[] = keyedCards(game, state.hand, `hand${seat}`, artOf);
  const graveyard: readonly GraveyardCard[] = keyedCards(game, state.graveyard, `gy${seat}`, artOf);
  // The snapshot's exile is one game-wide list, the way the kernel's is, so the
  // seat it belongs under is read off the recorded object table's `owner` — the
  // same split `../play/position.ts` makes from live state, from the same field.
  const exile: readonly ExileCard[] = keyedCards(
    game,
    snapshot.exile.filter((oid) => game.objects.get(oid)?.owner === seat),
    `ex${seat}`,
    artOf,
  );
  // Said as the seat's, which is the same rule the live board names its zones
  // by (`../play/position.ts`): these are the accessible names of the regions a
  // screen reader walks, and a zone naming rule that held on one of the two
  // boards and not the other is the drift both of them are drawn to avoid.
  const owns = seatPossessive(label);
  return {
    status,
    battlefield: { label: `${owns} battlefield`, permanents, count: controlledCount },
    hand: { label: `${owns} hand`, cards: hand },
    graveyard: { label: `${owns} graveyard`, cards: graveyard },
    ...(exile.length === 0 ? {} : { exile: { label: `${owns} exile`, cards: exile } }),
  };
}

/**
 * The recorded stack. An entry naming a source is an activated ability, whose
 * own id belongs to no card (CR 113.7a); it is drawn as the permanent it was
 * printed on, exactly as the live table draws it (`../play/position.ts`).
 *
 * A modal spell's chosen mode and its chosen targets are two fields, because
 * they are two facts: the mode says which spell this is out of the ones the card
 * offers, and the target says what that spell is pointed at. The mode rode on
 * `targetLabel` from `mtg-7si0` until `mtg-sujc` gave `StackItem`
 * (`../../board/StackZone.ts`) a field of its own, which is what lets the row
 * lay them out separately and a screen reader read them as two sentences.
 */
function stackItems(game: ReplayGameLog, snapshot: LogSnapshot, names: ReplayNames): readonly StackItem[] {
  const items: StackItem[] = [];
  for (const entry of snapshot.stack) {
    const card = entry.sourceCard ?? cardOf(game, entry.card);
    if (card === null) continue;
    const targets = entry.targets
      .filter((target) => target !== null)
      .map((target) => describeTarget(target, names));
    const base = {
      key: entry.oid,
      card,
      controller: names.player(entry.controller),
      ...(entry.source === null ? {} : { ability: true }),
    };
    const mode = stackModeLabel(card, entry.mode, entry.abilityIndex);
    const overload = entry.castingCost === 'overload' ? 'Overloaded' : null;
    const modeLabel = [overload, mode].filter((part): part is string => part !== null).join(' ');
    items.push({
      ...base,
      ...(modeLabel === '' ? {} : { modeLabel }),
      ...(targets.length === 0 ? {} : { targetLabel: `→ ${targets.join(', ')}` }),
    });
  }
  return items;
}

/**
 * The whole table for one recorded frame. Seat 0 is drawn nearest the viewer.
 *
 * `priority` is the seat the kernel asks next from this exact state — the
 * viewer reads it off the following step's decision rather than from the
 * snapshot, which does not carry one.
 *
 * `artFor` is the manifest's resolver or `null`, and `null` is an ordinary state
 * rather than a failure: a set that has not been through the art pipeline paints
 * the labeled pending frame on every face, which is the true statement about it.
 * The copy numbers are taken once for the whole log rather than per frame, so
 * stepping does not repaint a permanent with a different illustration.
 */
export function boardFrame(
  game: ReplayGameLog,
  snapshot: LogSnapshot,
  active: LogPlayerId,
  priority: LogPlayerId | null,
  names: ReplayNames,
  artFor: PositionArt = null,
): BoardProps {
  const artOf = artLookup(game, artFor);
  return {
    you: seatSide(game, snapshot, 0, active, priority, names, artOf),
    opponent: seatSide(game, snapshot, 1, active, priority, names, artOf),
    stack: { entries: stackItems(game, snapshot, names) },
  };
}

export interface BoardNote {
  readonly key: string;
  readonly text: string;
}

/**
 * Anything the card face cannot say for itself: a creature whose derived P/T
 * differs from its printed P/T. The frame prints the card, so a pumped creature
 * would otherwise read as its printed size.
 */
export function boardNotes(
  game: ReplayGameLog,
  snapshot: LogSnapshot,
  names: ReplayNames,
): readonly BoardNote[] {
  const notes: BoardNote[] = [];
  for (const permanent of snapshot.battlefield) {
    const card = permanent.copiedCard ?? cardOf(game, permanent.oid);
    if (card === null || !isCreature(card)) continue;
    const { power, toughness } = permanent;
    if (power === null || toughness === null) continue;
    if (power === card.power && toughness === card.toughness) continue;
    notes.push({
      key: permanent.oid,
      text: `${names.card(permanent.oid)} is ${power}/${toughness} (printed ${card.power}/${card.toughness}).`,
    });
  }
  return notes;
}
