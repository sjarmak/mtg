/**
 * The Forge snapshot as one seat may be *sent* it.
 *
 * `ForgeBridge.java` writes both hands into every snapshot when both seats are
 * local, because a hot-seat table draws one of them face down and the JVM has no
 * business knowing which. Across a wire that is the leak `@mtg/engine`'s
 * `seats.ts` argues against, and the contract (`docs/adr/0001-engine-strategy.md`
 * §9) puts the boundary here rather than in Java: the TypeScript side of the
 * bridge projects per seat and declares `perSeatProjection`.
 *
 * What a viewer may not identify is derived the way `hidden-information.ts`
 * derives it, from the other seat's hand: its object ids, and any card name that
 * belongs to exactly one object in the position. The audit searches each seat's
 * `JSON.stringify({ view, events, decision })` for those values as JSON string
 * literals, so this file searches the same bytes for the same literals and
 * rewrites an event that carries one. A redaction that searched anything
 * narrower than the audit would be a redaction the audit could fail.
 *
 * `EngineEvent.reveals` licenses an object to the seats it names, so an event
 * that reveals a concealed card to the viewer is left whole, and a reveal
 * addressed only to the other seat is dropped from the viewer's copy so its id
 * cannot ride out in the licensing field itself.
 */
import type {
  EngineEvent,
  EngineReveal,
  ObjectView,
  PendingDecision,
  SeatId,
  SeatProjection,
  TableView,
} from '@mtg/engine';
import { perSeat, seatViewOf } from '@mtg/engine';
import type { SnapshotResponse } from './protocol';

/** What one viewer may not identify in a position, derived from the other seat's hand. */
export interface ConcealedFrom {
  readonly oids: ReadonlySet<string>;
  readonly uniqueNames: ReadonlySet<string>;
}

function otherSeat(seat: SeatId): SeatId {
  return seat === 0 ? 1 : 0;
}

function objectsIn(view: TableView): readonly ObjectView[] {
  return [
    ...view.stack,
    ...view.seats.flatMap((seat) => [
      ...(seat.hand ?? []),
      ...seat.graveyard,
      ...seat.exile,
      ...seat.battlefield,
      ...(seat.commandZone ?? []),
      ...(seat.avatars ?? []),
      ...(seat.libraryTop ?? []),
    ]),
  ];
}

/**
 * The other seat's hand, as ids and as the names that would identify one card.
 *
 * A name counts as identifying only when exactly one object in the whole
 * position carries it, which is the audit's own rule: four Islands make "Island
 * is absent" false the moment one is on the battlefield.
 */
export function concealedFrom(view: TableView, viewer: SeatId): ConcealedFrom {
  const hand = seatViewOf(view, otherSeat(viewer)).hand ?? [];
  const counts = new Map<string, number>();
  for (const object of objectsIn(view)) counts.set(object.name, (counts.get(object.name) ?? 0) + 1);
  const uniqueNames = new Set<string>();
  for (const card of hand) {
    if (counts.get(card.name) === 1) uniqueNames.add(card.name);
  }
  return { oids: new Set(hand.map((card) => card.oid)), uniqueNames };
}

/**
 * Drops the wire's always-present `input` when Forge wrote no text box.
 *
 * The contract's `input` is absent on an ordinary decision, not null, and
 * `exactOptionalPropertyTypes` makes those two different types.
 */
export function contractDecision(wire: SnapshotResponse['decision']): PendingDecision | null {
  if (wire === null) return null;
  const { input, manaPayment: _manaPayment, options, ...rest } = wire;
  const contractOptions = options.map(({ manaPayment: _optionPayment, ...option }) => option);
  return input === null
    ? { ...rest, options: contractOptions }
    : { ...rest, options: contractOptions, input };
}

function viewFor(view: TableView, viewer: SeatId): TableView {
  const other = otherSeat(viewer);
  return {
    ...view,
    seats: perSeat(view.seats.map((seat) => (seat.id === other ? { ...seat, hand: null } : seat))),
  };
}

function licensedTo(events: readonly EngineEvent[], viewer: SeatId): ReadonlySet<string> {
  const oids = new Set<string>();
  for (const event of events) {
    for (const reveal of event.reveals) {
      if (reveal.seats.includes(viewer)) oids.add(reveal.oid);
    }
  }
  return oids;
}

/**
 * Whether one event would identify a concealed card to its reader.
 *
 * Ids and names are searched in the event's JSON as string literals, which is
 * the audit's own search. The sentence is searched again for the bare name,
 * because "Guest looked at Guest Secret" carries the name inside a longer
 * literal that the audit's quoted search reads past and a person does not.
 */
function namesConcealed(event: EngineEvent, concealed: ConcealedFrom): boolean {
  const json = JSON.stringify(event);
  for (const oid of concealed.oids) {
    if (json.includes(JSON.stringify(oid))) return true;
  }
  for (const name of concealed.uniqueNames) {
    if (json.includes(JSON.stringify(name)) || event.text.includes(name)) return true;
  }
  return false;
}

/**
 * Rewrites an event that would identify a concealed card to `viewer`.
 *
 * The rewritten entry keeps its sequence, its type and its licensing so the log
 * stays the same length in the same order; only the sentence and the backend's
 * payload go, because those are the two fields the bridge writes card names and
 * `sourceOid`s into.
 */
function eventFor(event: EngineEvent, viewer: SeatId, concealed: ConcealedFrom, actor: string): EngineEvent {
  const reveals: readonly EngineReveal[] = event.reveals.filter((reveal) => reveal.seats.includes(viewer));
  const kept = reveals.length === event.reveals.length ? event : { ...event, reveals };
  if (reveals.length !== event.reveals.length) {
    return { ...kept, text: `${actor} acted on a concealed card`, detail: undefined };
  }
  if (!namesConcealed(kept, concealed)) return kept;
  return { ...kept, text: `${actor} acted on a concealed card`, detail: undefined };
}

/**
 * What stays concealed from `viewer` once the log's own reveals are honored: a
 * card the events have shown this seat is no longer searched for, by id or by
 * name, which is exactly the license the audit grants.
 */
function unlicensed(view: TableView, events: readonly EngineEvent[], viewer: SeatId): ConcealedFrom {
  const concealed = concealedFrom(view, viewer);
  const licensed = licensedTo(events, viewer);
  const oids = new Set<string>();
  const uniqueNames = new Set<string>();
  for (const card of seatViewOf(view, otherSeat(viewer)).hand ?? []) {
    if (licensed.has(card.oid)) continue;
    oids.add(card.oid);
    if (concealed.uniqueNames.has(card.name)) uniqueNames.add(card.name);
  }
  return { oids, uniqueNames };
}

/** The bridge snapshot behind `SeatProjection`, computed per seat on demand. */
export function seatProjection(snapshot: SnapshotResponse): SeatProjection {
  const events = snapshot.events as readonly EngineEvent[];
  return {
    view: (seat: SeatId): TableView => viewFor(snapshot.view, seat),
    events: (seat: SeatId): readonly EngineEvent[] => {
      const concealed = unlicensed(snapshot.view, events, seat);
      const actor = seatViewOf(snapshot.view, otherSeat(seat)).name;
      return events.map((event) => eventFor(event, seat, concealed, actor));
    },
    decision: (seat: SeatId): PendingDecision | null =>
      snapshot.decision !== null && snapshot.decision.seat === seat
        ? contractDecision(snapshot.decision)
        : null,
  };
}
