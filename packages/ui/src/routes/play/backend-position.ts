/** Honest adapter from the neutral engine projection into the shared board. */
import type { Card as DslCard } from '@mtg/dsl';
import type {
  ObjectView,
  PendingDecision,
  PlayInteraction,
  PlayManaPool,
  SeatId,
  SeatView,
  TableView,
} from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';
import { releaseDateOf } from '@mtg/printed-card';
import type { BoardPod, BoardProps, BoardSide } from '../../board/Board';
import type { CommanderDamageFrom, SeatRailEntry } from '../../board/SeatRail';
import type { BrowserCard } from '../../board/ZoneBrowser';
import type { HandCard } from '../../board/Hand';
import type { CommanderCard } from '../../board/CommandZone';
import type { BoardPair, BoardPermanent } from '../../board/Battlefield';
import type { PlayerCounter } from '../../board/PlayerStatus';
import type { StackItem } from '../../board/StackZone';
import {
  missingPrintedCardArt,
  missingPrintedDisplayCard,
  printedCardArt,
  printedDisplayCard,
  printedIdentity,
} from '../../card/printed-card-art';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { narrowByKeywords } from '../../card/printed-keywords';

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function catalogIndex(
  cards: readonly PrintedCardPresentation[],
): ReadonlyMap<string, readonly PrintedCardPresentation[]> {
  const index = new Map<string, PrintedCardPresentation[]>();
  const add = (name: string, card: PrintedCardPresentation): void => {
    const key = normalizedName(name);
    const candidates = index.get(key) ?? [];
    if (!candidates.some((candidate) => candidate.physicalId === card.physicalId)) {
      candidates.push(card);
    }
    index.set(key, candidates);
  };
  for (const card of cards) {
    add(card.name, card);
    for (const face of card.faces) add(face.name, card);
    for (const observedName of card.observedNames ?? []) add(observedName, card);
  }
  return index;
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function isBasicLandPrinting(card: PrintedCardPresentation): boolean {
  return /^Basic Land\b/i.test(card.typeLine);
}

/**
 * Orders same-card printings oldest first, for a tie a stated fact cannot
 * break. A known release date beats an unrecorded one (`releaseDateOf`
 * covers every set a printed format has actually onboarded); within one
 * date, the lower catalog position is the earlier entry on that set's own
 * sheet. Never a guess between two different cards: callers only reach this
 * once every candidate has been proven the same card by oracle id.
 */
function byAge(left: PrintedCardPresentation, right: PrintedCardPresentation): number {
  const leftDate = releaseDateOf(left.setCode);
  const rightDate = releaseDateOf(right.setCode);
  if (leftDate !== rightDate) {
    if (leftDate === undefined) return 1;
    if (rightDate === undefined) return -1;
    return leftDate < rightDate ? -1 : 1;
  }
  return left.position - right.position;
}

/** Resolve only ambiguities whose presentation semantics make the choice safe. */
function printingFor(
  object: ObjectView,
  candidates: readonly PrintedCardPresentation[],
): PrintedCardPresentation | undefined {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return undefined;
  if (candidates.every(isBasicLandPrinting)) {
    return candidates[stableIndex(object.oid, candidates.length)];
  }
  // A name shared between a card and the token it makes (Karox Bladewing), or
  // between two token printings (the blue and the colorless Thopter), is
  // settled by facts the backend states about the object, never by guessing:
  // whether it is a token, and what colors it is. Two black Vampires of
  // different oracle ids (1/1 lifelink, 2/2 flying) survive that and are then
  // told apart by the keywords the object has now (`mtg-oin1f`); power and
  // toughness are not used, because they move with pumps and counters.
  const stated = candidates.filter(
    (candidate) =>
      (object.characteristics?.token === undefined ||
        /^Token\b/u.test(candidate.typeLine) === object.characteristics.token) &&
      (object.characteristics?.colors === undefined ||
        candidate.colors.join('') === object.characteristics.colors.join('')),
  );
  if (stated.length === 1) return stated[0];
  const narrowed = narrowByKeywords(object, stated);
  if (narrowed.length === 1) return narrowed[0];
  const oracleIds = new Set(candidates.map((candidate) => candidate.oracleId));
  const ordinary = candidates.filter(
    (candidate) => candidate.rarity !== 'special' && candidate.rarity !== 'bonus',
  );
  if (oracleIds.size !== 1 || ordinary.length === 0) return undefined;
  // Several printings the backend cannot tell apart (Innistrad token sheet
  // reprints "Zombie" three times over collector numbers 7-9, one oracle id,
  // one color, one power/toughness) are still one card. Rather than leave it
  // blank, present the oldest instead of the newest.
  if (ordinary.length === 1) return ordinary[0];
  return [...ordinary].sort(byAge)[0];
}

function presentedObject(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
): { readonly card: DslCard; readonly art: ReturnType<typeof missingPrintedCardArt> } {
  const printed = printingOf(object, index);
  return {
    card: printed === undefined ? missingPrintedDisplayCard(object) : printedDisplayCard(printed, object),
    art: printed === undefined ? missingPrintedCardArt(object) : printedCardArt(printed, object),
  };
}

function printingOf(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
): PrintedCardPresentation | undefined {
  return printingFor(object, index.get(normalizedName(object.name)) ?? []);
}

function zoneCard(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
): BrowserCard {
  return { key: object.oid, ...presentedObject(object, index) };
}

function handCard(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
): HandCard {
  return { key: object.oid, ...presentedObject(object, index), playable: false };
}

/**
 * The next cast's cost with the commander tax folded in (CR 903.8): `{2}` more
 * for every time the engine has already seen the card cast from the zone. The
 * generic figure is merged rather than appended, so a taxed Emmara reads
 * `{4}{W}{G}` the way Forge's own payment prompt prints it.
 */
export function commanderCost(manaCost: string | null, casts: number): string | null {
  if (manaCost === null) return casts === 0 ? null : `{${String(2 * casts)}}`;
  if (casts === 0) return manaCost;
  const generic = /^\{(\d+)\}/u.exec(manaCost);
  if (generic?.[1] === undefined) return `{${String(2 * casts)}}${manaCost}`;
  return `{${String(Number(generic[1]) + 2 * casts)}}${manaCost.slice(generic[0].length)}`;
}

function commanderCard(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
  casts: number,
): CommanderCard {
  return {
    ...handCard(object, index),
    casts,
    cost: commanderCost(object.characteristics?.manaCost ?? null, casts),
  };
}

/**
 * The declared blocks of the whole table, read off the attackers.
 *
 * The projection writes a block once, on the attacker (`ObjectView.blockedBy`),
 * because CR 509.1a makes a block an assignment to one attacker and one place
 * to write it is one place for the two seats' views to disagree. The board says
 * it from both ends — `blockedBy` on the attacker, `blockingAttackers` on the
 * blocker — and by key as well as by name, since the seam pairs cards by key
 * and a reader is told the names (`../../board/CombatZone.ts`). A blocker the
 * projection names that no battlefield holds keeps its `oid` as its name rather
 * than being dropped: the sentence stays wrong out loud instead of silently
 * shorter.
 */
interface CombatFacts {
  readonly attacking: boolean;
  readonly blocking?: boolean;
  readonly blockedBy?: readonly string[];
  readonly blockingAttackers?: readonly string[];
  readonly blockingKeys?: readonly string[];
}

class DeclaredBlocks {
  private readonly names = new Map<string, string>();
  private readonly attackers = new Map<string, ObjectView[]>();

  constructor(view: TableView) {
    const permanents = view.seats.flatMap((seat) => seat.battlefield);
    for (const object of permanents) this.names.set(object.oid, object.name);
    for (const object of permanents) {
      for (const blocker of object.blockedBy ?? []) {
        const attacking = this.attackers.get(blocker) ?? [];
        this.attackers.set(blocker, [...attacking, object]);
      }
    }
  }

  private nameOf(oid: string): string {
    return this.names.get(oid) ?? oid;
  }

  facts(object: ObjectView): CombatFacts {
    const blockedBy = object.blockedBy ?? [];
    const attackers = this.attackers.get(object.oid) ?? [];
    return {
      attacking: object.attacking,
      ...(blockedBy.length === 0 ? {} : { blockedBy: blockedBy.map((oid) => this.nameOf(oid)) }),
      ...(attackers.length === 0
        ? {}
        : {
            blocking: true,
            blockingAttackers: attackers.map((attacker) => attacker.name),
            blockingKeys: attackers.map((attacker) => attacker.oid),
          }),
    };
  }
}

/**
 * The soulbond pairs of the whole table, numbered so a reader can tell which
 * two creatures are bonded to one another (`mtg-in4k9`, the playtester's ruling on
 * dec-6044: one matching badge on both members, tinted or numbered per pair,
 * and no line drawn between them).
 *
 * The projection writes `pairedWith` on both members, each naming the other, so
 * a pair is the unordered couple of the two `oid`s and either end finds it. The
 * number is the pair's order of first appearance walking the battlefields in
 * seat order, which gives both members the same digit on every render and
 * different pairs different digits at any one moment. It is derived from the
 * position rather than stored, so it renumbers when an earlier pair dissolves;
 * that is the cost of keeping the view a function of the projection alone.
 *
 * A partner the table does not hold keeps its `oid` as its name, the way
 * `DeclaredBlocks` treats a vanished blocker: the sentence stays wrong out loud
 * instead of silently shorter.
 */
class SoulbondPairs {
  private readonly names = new Map<string, string>();
  private readonly numbers = new Map<string, number>();

  constructor(view: TableView) {
    const permanents = view.seats.flatMap((seat) => seat.battlefield);
    for (const object of permanents) this.names.set(object.oid, object.name);
    for (const object of permanents) {
      if (object.pairedWith === undefined) continue;
      const pair = pairKey(object.oid, object.pairedWith);
      if (!this.numbers.has(pair)) this.numbers.set(pair, this.numbers.size + 1);
    }
  }

  facts(object: ObjectView): { readonly pair?: BoardPair } {
    if (object.pairedWith === undefined) return {};
    return {
      pair: {
        number: this.numbers.get(pairKey(object.oid, object.pairedWith)) ?? 1,
        partner: this.names.get(object.pairedWith) ?? object.pairedWith,
      },
    };
  }
}

/** One key for a couple whichever end names it; `oid`s are opaque, so only compared. */
function pairKey(left: string, right: string): string {
  return JSON.stringify(left < right ? [left, right] : [right, left]);
}

/** What the board reads off the table besides one object's own fields. */
interface TableRelations {
  readonly blocks: DeclaredBlocks;
  readonly pairs: SoulbondPairs;
}

function permanent(
  object: ObjectView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
  relations: TableRelations,
): BoardPermanent {
  return {
    key: object.oid,
    ...presentedObject(object, index),
    // The display card's id is one per object, so it cannot say which
    // permanents are copies; the printing (or, for a token, its name and type
    // line) can, and that is what the battlefield piles on.
    pileId: printedIdentity(object, printingOf(object, index)),
    tapped: object.tapped,
    ...relations.blocks.facts(object),
    ...relations.pairs.facts(object),
    damage: object.damage,
    namedCounters: object.counters,
    playable: false,
    ...(object.power === null || object.toughness === null
      ? {}
      : { stats: { power: object.power, toughness: object.toughness } }),
  };
}

/**
 * The counters a seat holds, poison first and the rest by name, none of them a
 * zero. Empty is what the pod reads as "draw no row", so a seat with no Energy
 * and no poison (every seat of a kernel table, nineteen of twenty-one printed
 * formats) is drawn exactly as it was. Names are lowercased for the row: a
 * backend's counter kinds are its own words (`ENERGY`) and the pod sets them in
 * sentence case beside "hand" and "library". At a pod the rail already draws
 * every seat's poison (`SeatRailEntry.poison`), so the pod's own row leaves it
 * out rather than say it twice.
 */
function playerCounters(seat: SeatView, poisonOnRail: boolean): readonly PlayerCounter[] {
  const others = Object.entries(seat.playerCounters ?? {})
    .map(([name, amount]) => ({ name: name.toLowerCase(), amount }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const poison = poisonOnRail ? [] : [{ name: 'poison', amount: seat.poison ?? 0 }];
  return [...poison, ...others].filter((counter) => counter.amount > 0);
}

function side(
  seat: SeatView,
  seatId: SeatId,
  view: TableView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
  mana: PlayManaPool | undefined,
  relations: TableRelations,
): BoardSide {
  const hand = seat.hand;
  const commandZone = seat.commandZone;
  const avatars = seat.avatars;
  const libraryTop = seat.libraryTop;
  const counters = playerCounters(seat, view.seats.length > 2);
  return {
    status: {
      name: seat.name,
      life: seat.life,
      handCount: seat.handSize,
      libraryCount: seat.librarySize,
      graveyardCount: seat.graveyard.length,
      active: view.turn.active === seatId,
      priority: view.priority === seatId,
      ...(mana === undefined ? {} : { mana }),
      ...(counters.length === 0 ? {} : { counters }),
    },
    battlefield: {
      label: `${seat.name} battlefield`,
      permanents: seat.battlefield.map((object) => permanent(object, index, relations)),
    },
    // The seat pod already reports a hidden hand's exact count. Drawing that
    // count again as face-down cards makes them look like empty permanent
    // places on the far side of the table and disagrees with the kernel-backed
    // shared surface. A revealed hand still gets the ordinary hand rail.
    ...(hand === null
      ? {}
      : {
          hand: {
            label: `${seat.name} hand`,
            cards: hand.map((object) => handCard(object, index)),
            slots: Math.max(7, seat.handSize),
          },
        }),
    ...(commandZone === undefined
      ? {}
      : {
          commandZone: {
            label: `${seat.name} command zone`,
            commanders: commandZone.map((object) =>
              commanderCard(object, index, seat.commanderCasts?.[object.oid] ?? 0),
            ),
            tally: Object.values(seat.commanderCasts ?? {}).reduce((sum, casts) => sum + casts, 0),
          },
        }),
    ...(avatars === undefined
      ? {}
      : {
          avatars: {
            label: `${seat.name} avatar`,
            cards: avatars.map((object) => handCard(object, index)),
          },
        }),
    // The top of the library while the engine says it is public (Oracle of Mul
    // Daya): a card either seat can read, played or cast from there the way a
    // held card is, and drawn beside the battlefield with the command zone.
    ...(libraryTop === undefined
      ? {}
      : {
          libraryTop: {
            label: `${seat.name} library top`,
            cards: libraryTop.map((object) => handCard(object, index)),
          },
        }),
    graveyard: {
      label: `${seat.name} graveyard`,
      cards: seat.graveyard.map((object) => zoneCard(object, index)),
    },
    ...(seat.exile.length === 0
      ? {}
      : {
          exile: {
            label: `${seat.name} exile`,
            cards: seat.exile.map((object) => zoneCard(object, index)),
          },
        }),
  };
}

function stackItem(
  object: ObjectView,
  view: TableView,
  index: ReadonlyMap<string, readonly PrintedCardPresentation[]>,
): StackItem {
  return {
    key: object.oid,
    ...presentedObject(object, index),
    controller: view.seats[object.controller]?.name ?? `Seat ${String(object.controller + 1)}`,
  };
}

export function visibleObjects(view: TableView): readonly ObjectView[] {
  return [
    ...view.stack,
    ...view.seats.flatMap((seat) => [
      ...(seat.hand ?? []),
      ...(seat.commandZone ?? []),
      ...(seat.avatars ?? []),
      ...(seat.libraryTop ?? []),
      ...seat.battlefield,
      ...seat.graveyard,
      ...seat.exile,
    ]),
  ];
}

function append<K>(bucket: Map<K, string[]>, key: K, id: string): void {
  const ids = bucket.get(key) ?? [];
  if (!ids.includes(id)) ids.push(id);
  bucket.set(key, ids);
}

/**
 * Groups exact enumerated moves by the projected object that identifies them.
 *
 * Targets use the decision contract's opaque object identity; action sources
 * use the play contract's explicit object roles. Display text is never parsed.
 * Multiple moves remain multiple; the caller must ask rather than choose one.
 */
export function movesByObject(
  view: TableView,
  viewer: SeatId,
  decision: PendingDecision | null,
  play?: PlayInteraction | undefined,
): ReadonlyMap<string, readonly string[]> {
  if (decision === null || decision.seat !== viewer || decision.input !== undefined) return new Map();
  const objects = visibleObjects(view);
  const byOid = new Map(objects.map((object) => [object.oid, object]));
  const candidates = new Map<string, string[]>();

  for (const option of decision.options) {
    if (option.targets.length > 0) {
      for (const target of option.targets) {
        if (byOid.has(target.oid)) append(candidates, target.oid, option.id);
      }
    }
  }

  const offered = new Set(decision.options.map((option) => option.id));
  for (const action of play?.objectActions ?? []) {
    if (byOid.has(action.oid) && offered.has(action.move)) append(candidates, action.oid, action.move);
  }

  return new Map([...candidates.entries()].map(([oid, ids]) => [oid, [...ids]]));
}

/** Groups only backend-declared player roles; no label or move-id parsing occurs here. */
export function movesBySeat(
  viewer: SeatId,
  decision: PendingDecision | null,
  play?: PlayInteraction | undefined,
): ReadonlyMap<SeatId, readonly string[]> {
  if (decision === null || decision.seat !== viewer || decision.input !== undefined) return new Map();
  const offered = new Set(decision.options.map((option) => option.id));
  const candidates = new Map<SeatId, string[]>();
  for (const action of play?.seatActions ?? []) {
    if (!offered.has(action.move)) continue;
    append(candidates, action.seat, action.move);
  }
  return new Map([...candidates.entries()].map(([seat, ids]) => [seat, [...ids]]));
}

/** The direct-click subset: one object, one exact move, no inferred default. */
export function unambiguousMoveByObject(
  view: TableView,
  viewer: SeatId,
  decision: PendingDecision | null,
  play?: PlayInteraction | undefined,
): ReadonlyMap<string, string> {
  return new Map(
    [...movesByObject(view, viewer, decision, play)].flatMap(([oid, ids]) =>
      ids.length === 1 ? [[oid, ids[0]!] as const] : [],
    ),
  );
}

/**
 * Whether this table reports the commander game at all, so the rail draws chips
 * only where a chip could ever be nonzero.
 *
 * Any one of the three fields is enough: a backend that speaks Commander states
 * at least the zone at every position (`checkBackend` holds it to that), and a
 * four-seat free-for-all reports none of them and would otherwise carry a column
 * of zero chips saying nothing about a rule it is not playing.
 */
function playsCommander(view: TableView): boolean {
  return (
    view.commanderDamageMatrix !== undefined ||
    view.seats.some((seat) => seat.commandZone !== undefined || seat.commanderDamage !== undefined)
  );
}

/** The seat each commander belongs to, by the `oid` the per-commander tallies are keyed on. */
function commanderOwners(view: TableView): ReadonlyMap<string, SeatId> {
  const owners = new Map<string, SeatId>();
  for (const [dealer, seat] of view.seats.entries()) {
    for (const oid of Object.keys(seat.commanderCasts ?? {})) owners.set(oid, dealer);
    for (const object of seat.commandZone ?? []) owners.set(object.oid, dealer);
  }
  return owners;
}

/**
 * What each other seat's commanders have done to `receiver`, one entry per dealer.
 *
 * The matrix is the source when the backend states it, since it is the one
 * figure the projection promises per dealer. The per-commander tally is what
 * CR 903.10a is actually about, so it rides along as `peak`: two partners who
 * have dealt ten each are twenty from one dealer and nowhere near lethal from
 * either, and the tone has to read the second fact.
 */
function damageTaken(
  view: TableView,
  receiver: SeatId,
  owners: ReadonlyMap<string, SeatId>,
): readonly CommanderDamageFrom[] {
  const perCommander = Object.entries(seatViewOf(view, receiver).commanderDamage ?? {});
  return view.seats.flatMap((dealer, dealerId): readonly CommanderDamageFrom[] => {
    if (dealerId === receiver) return [];
    const fromCommanders = perCommander
      .filter(([oid]) => owners.get(oid) === dealerId)
      .map(([, dealt]) => dealt);
    const stated = view.commanderDamageMatrix?.[dealerId]?.[receiver];
    return [
      {
        dealer: dealerId,
        name: dealer.name,
        amount: stated ?? fromCommanders.reduce((sum, dealt) => sum + dealt, 0),
        ...(fromCommanders.length === 0 ? {} : { peak: Math.max(...fromCommanders) }),
      },
    ];
  });
}

function railEntry(
  view: TableView,
  viewer: SeatId,
  seat: SeatView,
  seatId: SeatId,
  owners: ReadonlyMap<string, SeatId> | null,
): SeatRailEntry {
  return {
    seat: seatId,
    name: seat.name,
    you: seatId === viewer,
    life: seat.life,
    poison: seat.poison ?? null,
    damage: owners === null ? [] : damageTaken(view, seatId, owners),
    active: view.turn.active === seatId,
    priority: view.priority === seatId,
  };
}

/**
 * The opponent the combat band is drawn from, for a table with several.
 *
 * The band holds one opponent's creatures, so the choice is whose. On another
 * player's turn it is theirs, since their attackers are what the viewer is being
 * asked to block. On the viewer's own turn it is the opponent whose creatures are
 * blocking, because that is the half of the fight the band exists to show; before
 * any block is declared it is the seat after the viewer, which is the seat a duel
 * would have drawn and a stable place for the eye to return to.
 */
function primaryOpponent(view: TableView, viewer: SeatId, order: readonly SeatId[]): SeatId {
  const active = view.turn.active;
  if (active !== viewer) return active;
  const blockers = new Set(
    view.seats.flatMap((seat) => seat.battlefield).flatMap((object) => object.blockedBy ?? []),
  );
  const blocking = order.find((seat) =>
    seatViewOf(view, seat).battlefield.some((object) => blockers.has(object.oid)),
  );
  return blocking ?? order[0] ?? active;
}

/**
 * The pod arm: a table of more than two, where "the opponent" is several.
 *
 * `opponent` stays one of them so the seam, the aiming and the click gestures
 * that already read it keep reading it; the rest are `pod.others`, drawn beside
 * it in the order the seats sit around the table starting after the viewer,
 * which is turn order and so the order a threat reaches you in.
 */
function podPosition(
  view: TableView,
  viewer: SeatId,
  sideOf: (seat: SeatId) => BoardSide,
): { readonly opponent: BoardSide; readonly pod: BoardPod } {
  const count = view.seats.length;
  const order = Array.from({ length: count - 1 }, (_, step) => (viewer + 1 + step) % count);
  const primary = primaryOpponent(view, viewer, order);
  const owners = playsCommander(view) ? commanderOwners(view) : null;
  const at = order.indexOf(primary);
  return {
    opponent: sideOf(primary),
    pod: {
      rail: {
        seats: view.seats.map((seat, seatId) => railEntry(view, viewer, seat, seatId, owners)),
      },
      opponentSeat: primary,
      others: order.filter((seat) => seat !== primary).map((seat) => ({ seat, side: sideOf(seat) })),
      opponentAt: at,
    },
  };
}

export function backendBoardPosition(
  view: TableView,
  viewer: SeatId,
  printedCards: readonly PrintedCardPresentation[] = [],
  play?: PlayInteraction | undefined,
): BoardProps {
  const index = catalogIndex(printedCards);
  const relations: TableRelations = { blocks: new DeclaredBlocks(view), pairs: new SoulbondPairs(view) };
  const sideOf = (seat: SeatId): BoardSide =>
    side(seatViewOf(view, seat), seat, view, index, play?.manaPools?.[seat], relations);
  const stack = { entries: view.stack.map((object) => stackItem(object, view, index)) };
  if (view.seats.length > 2) return { ...podPosition(view, viewer, sideOf), you: sideOf(viewer), stack };
  const opponent: SeatId = viewer === 0 ? 1 : 0;
  return { opponent: sideOf(opponent), you: sideOf(viewer), stack };
}
