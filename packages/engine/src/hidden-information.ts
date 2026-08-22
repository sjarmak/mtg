/**
 * The payload search, lifted out of `@mtg/netplay`'s test and asked of any
 * backend that claims to project per seat.
 *
 * `packages/netplay/test/hidden-information.test.ts` plays a whole game and, at
 * every decision, takes the bytes each seat would be sent and asks whether they
 * name a card that seat may not identify. That test is about one server over one
 * engine. The question it asks is about the *seam*: a backend that declares
 * `perSeatProjection` is promising exactly this and nothing weaker, and a promise
 * checked in one package's test is a promise the second backend never has to
 * keep. So the check moves to where the declaration is, and the netplay test
 * keeps its own copy of the question over its own wire format.
 *
 * **Nothing here imports `@mtg/netplay` or `@mtg/kernel`,** which is the whole
 * reason it could move: the search runs over the neutral projection, whose ids
 * and names are the contract's own.
 *
 * # How it knows what a seat may not see, without asking the backend
 *
 * From the other seat's own view. Between them the two per-seat views name every
 * object either player is entitled to identify, so what seat 0 may not see is
 * what seat 1 may — the same derivation the netplay test uses, and for the same
 * reason: a check that asked the backend what it concealed and then confirmed
 * exactly that was missing would agree with the implementation by construction
 * and pass on any bug the implementation has.
 *
 * # It searches for ids first and names second
 *
 * An id is unambiguous and every object has one, so the id search is the one
 * that carries the weight and it is never vacuous. The name search is the
 * netplay test's own, and it is kept because a backend can conceal an id and
 * still write "your opponent is holding a Mountain" into a sentence; it applies
 * only to names that belong to exactly one object in the position, because four
 * copies of one card make "the name is absent" false the moment any copy is
 * legitimately on the battlefield.
 *
 * Both searches are for the value as a JSON string literal, quotes included. A
 * bare substring search reports `o1` present because `o12` is in the payload,
 * which is a false alarm that reads exactly like the leak this is for.
 *
 * # The seed is searched too, and that one is a bare substring
 *
 * A seed is not one more card. With the two decklists it reproduces every
 * shuffle in the match, so it is both libraries in one string and it is the leak
 * a card search cannot find: no object carries it, and every absence check above
 * passes on a payload that opens with it. `@mtg/kernel`'s `visibility.ts` clears
 * it twice for that reason, out of the state and out of `gameStarted`, and the
 * second of those was found by a payload test rather than by reading the code.
 * That is the argument for asking it here: a backend on the recorded arm has a
 * seed by construction, and until now the only suite that looked for one was the
 * kernel's own.
 *
 * The search is a bare substring rather than a JSON literal, which is the
 * opposite of the rule one paragraph up and is deliberate. An id leaks as a
 * whole field and a seed leaks inside a sentence — "dealt from <seed>" is the
 * shape a friendly log line takes — so the literal search would miss exactly the
 * case worth catching. The cost is that a seed short enough to occur by accident
 * reports a leak that is not one, and that failure is loud, lands at the seam
 * rather than in somebody's game, and is answered by choosing a longer seed.
 *
 * # A library is enumerable in retrospect, and that is how it is checked
 *
 * The projection carries `librarySize` and no card list, so at any one position
 * there is nothing to search for. The way in is that a library is not a sealed
 * zone: cards come out of it, and the position *after* they come out names them.
 *
 * So the check runs backwards. An object that becomes identifiable at one
 * position, was identifiable nowhere at the position before, and whose arrival
 * is accounted for by its seat's `librarySize` falling by exactly the number of
 * such arrivals, was in that library one move ago. It must therefore not have
 * been named in the *other* seat's payload one move ago, and the previous
 * payload is still in hand to search.
 *
 * The expectation comes from a later output of the backend than the payload it
 * indicts, which is the property that makes it evidence. A backend cannot
 * satisfy it by declaring anything; it has to have actually not named the card,
 * and it cannot know at the time which card it will later have to have not
 * named.
 *
 * # Why the seat's own payload is not checked the same way
 *
 * Because a player is often entitled to know cards in their own library, and the
 * contract has no way to tell when. Scry puts a known card back on top; the
 * London mulligan puts known cards on the bottom in an order the player chose;
 * a shuffle effect after either one takes that knowledge away again. Whether the
 * owner may identify their own next draw is a function of which effects they
 * have applied, not of which zone the card is in, and a per-seat knowledge log
 * is the thing `@mtg/kernel`'s `visibility.ts` says it does not have either
 * (`mtg-qbuq`). An absence check over the owner's own payload would report the
 * kernel's own scry as a leak.
 *
 * `@mtg/kernel` conceals both libraries including the viewer's own, which is
 * stricter than this and stays a kernel-level test, in the package that can say
 * what its own effects reveal. A foreign backend that shows a seat its own
 * library ordering is committing a rules error this suite does not catch, and a
 * surface adopting one has to read its concealment code for that specifically.
 *
 * # Why not a digest on `SeatView`
 *
 * A digest of a hidden zone is computed by the backend, out of the same bytes it
 * would be leaking. A leaking backend computes an honest digest and passes; a
 * concealing backend with an off-by-one in its hashing fails. What such a field
 * tests is the hashing. Making it a value only the owner can reproduce is a
 * commitment scheme, which needs a secret, a reveal and a verifier that holds
 * neither side, and this suite is none of those: it runs in the backend's own
 * process and calls both seats' projectors itself. There is no channel here for
 * cryptography to protect.
 *
 * Enumerating the library to its owner was the other way to make the existing
 * search work with no new machinery, and it fails on the rules rather than on
 * the cost: CR 401.1 says a player may not look at their own library, so a
 * projection that carried the ordering would be wrong in a way no test in this
 * package could see, and one that carried an unordered multiset would be
 * carrying a promise about ordering that the schema cannot state and the suite
 * cannot check.
 *
 * # What it cannot see
 *
 * A card that never leaves the library during the game the suite plays. The
 * check sees exactly what comes out, so the bottom of a forty-card library in a
 * ten-turn game is never examined.
 *
 * A backend that leaks the library under identifiers other than the ones it
 * later hands out. That is an adversary rather than a mistake, and nothing short
 * of a commitment scheme reaches it.
 *
 * A position where the arrivals and the library count disagree, which is the
 * suite abstaining rather than guessing: a card can arrive from exile, which the
 * projection does not carry at all, and a library can shrink into exile with
 * nothing to show for it. Both are legitimate, so a position that does not add
 * up is skipped.
 *
 * A backend that lies about where the cards are, consistently. Put seat 0's
 * undrawn cards into seat 0's graveyard in *both* views and nothing here objects:
 * the three views agree, so `checkPublicAgreement` is satisfied, and the card is
 * in its owner's own view, so drawing it later is not an arrival. That is not a
 * concealment failure but a fabricated position, and this suite has no
 * independent account of where a card is — every value it reads is the backend's
 * own projection of it. The one thing that could contradict such a backend is a
 * decklist, and `SessionSpec.seats[n].deck.cards` is routinely empty because the
 * backend resolves the deck itself.
 *
 * The false alarm is the mirror of that last one, and it is worth stating
 * plainly because it will be somebody's first impression of the suite. The check
 * assumes the other seat never legitimately learned the card, and most of the
 * ways real Magic breaks that are still unhandled: a revealed top card, a
 * searched library. A backend that plays those will be reported as leaking a card
 * it was allowed to name, at a stated position, with the object id in the
 * finding, which is enough for its author to tell the two apart. That is the
 * same trade the seed search takes one section down.
 *
 * A hand reveal used to be a third item on that list and no longer is, and
 * neither is a card that was public and has gone back to a hand — the next
 * section is the scoped exception, and the object id in a finding is still how
 * its author tells a genuine leak from a shape this suite has not been taught
 * yet.
 *
 * # A reveal licenses specific objects, not a hand or a game
 *
 * Two legitimate transfers put a real object id into a payload that names a card
 * still, correctly, sitting in a hidden hand.
 *
 * The first is a hand reveal. CR 701.16a says the cards were shown to every
 * player, and `@mtg/kernel`'s `visibility.ts` argues at length for why redacting
 * that event would delete the effect rather than protect anything. The second is
 * an object that was public and went back: a creature bounced off the
 * battlefield keeps the id its opponent has been reading all game, published
 * legitimately by the spell that targeted it.
 *
 * Both survive because the log is cumulative. Once emitted, an id sits in every
 * later position's payload, so a correct backend would be reported as leaking one
 * finding per named card per position for the rest of the game — the bug this
 * section exists to close. **A per-event redactor cannot close it.** The kernel's
 * `zoneChanged` arm already replaces the id when a card moves into a hidden zone
 * and the finding survives that untouched, because the question is not "may this
 * event name this id" but "may this seat still identify this object", and the
 * second question is about the seat's history rather than about the event.
 *
 * So the license is a fold, and the input to the fold is `EngineEvent.reveals` —
 * a per-event delta, from the backend, saying which objects this event made
 * identifiable and to which seats. It is scoped three ways, and each is
 * load-bearing against the obvious wrong fix: switching the whole check off
 * wherever a reveal exists anywhere in the log, which would hand a leaking
 * backend a lever to disarm the suite with one unrelated reveal.
 *
 *  - **By object, not by hand or by game.** A viewer is licensed to know exactly
 *    the ids the deltas named, and nothing wider. A backend that reveals one card
 *    and leaks a different one is still caught, because the id it leaked was
 *    never in `PositionMemo.revealed`.
 *  - **By seat.** `EngineReveal.seats` names the seats that may identify the
 *    object, and only a payload sent to one of them is relieved. Said outright
 *    rather than inferred from whose hand it was: a reveal made to one seat must
 *    not quiet a leak in the other seat's payload, the same correction
 *    `PositionMemo.identified` carries.
 *  - **By presence.** The license is intersected with the hand's actual current
 *    contents at every position (`PositionMemo.revealed`, carried forward and
 *    re-filtered on each call). An object that leaves the hand — played,
 *    discarded, shuffled away — falls out of the intersection and stops being
 *    searched for at all, so there is nothing left to stay licensed. Nothing here
 *    tracks *why* an id left, because a card no longer in the concealed hand is
 *    not one this check is looking for.
 *
 * # What the field buys, and what it does not
 *
 * It does not make a backend honest. A delta the backend writes is exactly as
 * forgeable as the event it writes: a backend that fabricates a reveal naming a
 * card it is not actually letting the opponent identify is lying to the suite,
 * and this suite has no independent account of where a card is — the paragraph
 * five sections up says so about every value it reads, and the digest and
 * commitment-scheme paragraphs rule out the only techniques that would reach it.
 * A per-seat knowledge log does not change that either, wherever it lives, which
 * is a correction to what this file used to claim here.
 *
 * What it buys is real and narrower, and it is two things.
 *
 * For a backend whose deltas are *derived*, an entry becomes a consequence of
 * what the engine did rather than an assertion an emitter chose to make. The
 * kernel's adapter fills the field from the zone an object left
 * (`@mtg/kernel`'s `publiclyIdentified`), so a kernel bug that forgets a reveal
 * produces a false *leak* finding — loud, at the seam — rather than a silent
 * license. For a backend that simply says so, it stays a claim.
 *
 * For every backend, it removes the vocabulary agreement. The version this
 * replaced matched `event.type === 'handRevealed'` and a `{ player, oids }`
 * payload, which is one engine's word for the event and one engine's shape for
 * it, so a foreign backend that revealed hands under any other name got no
 * license at all and hit the wall above in full. A field needs no agreement: a
 * backend that reveals under any name fills `reveals` in, and this file never
 * learns what the event was called.
 *
 * A table that names no seed and a backend that reports none. `SessionSpec.seed`
 * is nullable on purpose and the observed arm may legitimately have nothing to
 * search for, so the seed check is skipped rather than failed. On the recorded
 * arm there is always one to search for, because `conformance.ts` already refuses
 * a recorded backend whose record carries an empty seed.
 */
import type { Finding } from './conformance';
import type { EngineEvent } from './events';
import type { ObjectView, TableView } from './projection';
import type { PendingDecision } from './decision';
import type { SeatProjection } from './seats';
import type { SeatId } from './table';
import { SEAT_IDS } from './table';

export interface SeatAudit {
  /**
   * How many (position, seat) pairs actually had a concealed card to look for.
   *
   * The positive control, summed by the caller over a whole game: a run that
   * searched nothing satisfies every absence check below on an empty payload.
   *
   * It counts hands only. The library check has no declaration behind it to be
   * vacuous against — a backend whose libraries never give up a card is a
   * backend without libraries, not one that dodged a promise — so folding its
   * observations in here would let a library-only game satisfy a control that
   * exists to make `perSeatProjection` mean something.
   */
  readonly searched: number;
  readonly findings: readonly Finding[];
  /** What this position leaves behind for the next one to check against. */
  readonly memo: PositionMemo;
}

/**
 * One position, kept so the next one can ask what came out of a library and
 * what a hand reveal has already licensed.
 *
 * Deliberately four small values rather than the two views: what the next
 * position needs is which objects were identifiable, how many cards each library
 * held, the bytes each seat was sent, and which objects a hand reveal has
 * licensed so far. Holding the views instead would mean re-deriving all four and
 * keeping every object alive for a position that no longer cares about them.
 */
export interface PositionMemo {
  /**
   * What each seat could identify here, by object id, in seat order.
   *
   * Per seat and not the union of the two, which is a correction rather than a
   * refinement: the union hands a leaking backend a way to switch the arrival
   * test off with the leak itself. Write seat 0's undrawn cards into seat *1*'s
   * view of seat 0's graveyard and those ids are in the union, so the card seat
   * 0 draws next is not an arrival, the count comes up one short of what the
   * library lost, and the position is skipped as ambiguous. A public zone used
   * as a hiding place, escaping through the guard that was supposed to make the
   * check honest.
   *
   * Scoped to the owner it cannot: the question is whether the object was
   * somewhere its own seat could already see it, and the other seat's view is
   * not evidence about that.
   */
  readonly identified: readonly [ReadonlySet<string>, ReadonlySet<string>];
  /** Each seat's library count, in seat order. */
  readonly librarySize: readonly [number, number];
  /** Each seat's whole payload as one string, in seat order. */
  readonly wire: readonly [string, string];
  /**
   * Per seat, the ids from that seat's own hand its opponent has been licensed
   * to identify by an `EngineEvent.reveals` delta, and that have stayed in the
   * hand ever since — see "A reveal licenses specific objects, not a hand or a
   * game" above for why the scoping is this narrow. Carried forward and re-intersected with the
   * hand's actual contents every position, which is what ends the license the
   * moment an object leaves: nothing here remembers that an id was ever
   * licensed once it is no longer in that seat's concealed hand.
   */
  readonly revealed: readonly [ReadonlySet<string>, ReadonlySet<string>];
}

/** `PositionMemo.revealed`'s value before any delta has licensed anything. */
const EMPTY_OIDS: ReadonlySet<string> = new Set();

export function auditSeatPayloads(
  seats: SeatProjection,
  table: TableView,
  pending: PendingDecision | null,
  at: string,
  /** The seed the match was dealt from, or null when nobody stated one. */
  seed: string | null,
  /** The position one move back, or null at the opening. */
  previous: PositionMemo | null,
): SeatAudit {
  const findings: Finding[] = [];
  const add = (detail: string): void => {
    findings.push({ check: 'hidden-information', detail });
  };
  const views: readonly [TableView, TableView] = [seats.view(0), seats.view(1)];
  const wire: [string, string] = ['', ''];
  const revealed: [Set<string>, Set<string>] = [new Set(), new Set()];
  let searched = 0;

  checkPublicAgreement(table, views, at, add);
  const named = nameCounts(views);

  for (const viewer of SEAT_IDS) {
    const other: SeatId = viewer === 0 ? 1 : 0;
    const mine = views[viewer];
    const own = mine.seats[viewer];
    if (own.hand === null) {
      add(`${at}: seat ${String(viewer)} was not sent its own hand, so it cannot play`);
    } else if (own.hand.length !== own.handSize) {
      add(
        `${at}: seat ${String(viewer)} was sent ${String(own.hand.length)} of its own ${String(own.handSize)} cards`,
      );
    }
    if (mine.seats[other].hand !== null) {
      add(`${at}: seat ${String(viewer)} was sent seat ${String(other)}'s hand`);
    }

    const question = seats.decision(viewer);
    const owed = pending !== null && pending.seat === viewer;
    if (owed && question === null) {
      add(`${at}: seat ${String(viewer)} is the seat being asked and was sent no question`);
    }
    if (!owed && question !== null) {
      // A discard decision names the cards in a hand, so an option list sent to
      // the wrong seat is a shorter road to the same leak the state would be.
      add(`${at}: seat ${String(viewer)} was sent an enumeration it does not owe`);
    }

    const concealed = views[other].seats[other].hand ?? [];
    if (concealed.length > 0) searched += 1;
    const events = seats.events(viewer);
    const payload = JSON.stringify({ view: mine, events, decision: question });
    wire[viewer] = payload;
    if (seed !== null && seed.length > 0 && payload.includes(seed)) {
      add(`${at}: seat ${String(viewer)}'s payload carries the seed the match was dealt from`);
    }
    // What of `other`'s hand `viewer` has already been shown, narrowed to what
    // is still actually in it — see "A reveal licenses specific objects, not a
    // hand or a game" at the top of the file. Recomputed every position rather
    // than only extended, so an object that left the hand since the last check
    // drops out here and stays out even if the same id later returns.
    const licensedBefore = previous?.revealed[other] ?? EMPTY_OIDS;
    const revealedNow = revealedTo(events, viewer);
    const license = new Set<string>();
    for (const card of concealed) {
      if (licensedBefore.has(card.oid) || revealedNow.has(card.oid)) license.add(card.oid);
    }
    revealed[other] = license;
    for (const card of concealed) {
      if (license.has(card.oid)) continue;
      if (payload.includes(JSON.stringify(card.oid))) {
        add(
          `${at}: object ${card.oid} is in seat ${String(other)}'s hand and in seat ${String(viewer)}'s payload`,
        );
      }
      if (named.get(card.name) === 1 && payload.includes(JSON.stringify(card.name))) {
        add(
          `${at}: "${card.name}" is in seat ${String(other)}'s hand and named in seat ${String(viewer)}'s payload`,
        );
      }
    }
  }

  if (previous !== null) checkLibraryArrivals(views, previous, at, add);
  return {
    searched,
    findings,
    memo: {
      identified: [identifiedIn(views[0]), identifiedIn(views[1])],
      librarySize: [views[0].seats[0].librarySize, views[1].seats[1].librarySize],
      wire,
      revealed,
    },
  };
}

/**
 * The cards that came out of a library between the last position and this one,
 * checked against what the other seat was sent before they came out.
 *
 * The arithmetic is the whole guard against guessing. A seat's arrivals are the
 * objects it now holds that *its own previous view* could not identify; they are
 * treated as having come from that seat's library only when their number is
 * exactly what the library lost. One arrival and one card gone is a draw or a
 * mill. Anything else — a token minted, a card back from exile, a library
 * shrinking into a zone the projection does not carry — makes the position
 * ambiguous, and an ambiguous position is skipped rather than reported.
 *
 * Owner-scoped rather than union-scoped, for the reason `PositionMemo` states,
 * and the guard survives the narrowing: a token minted at this position is in
 * neither seat's previous view, so it is still an arrival and still makes the
 * count disagree where it should. What the narrowing removes is the other seat's
 * hand, and the price is a contrived false alarm — a card that moves out of the
 * opponent's hand into this seat's zones in the same position this library gives
 * up exactly as many cards as arrived. No DSL effect moves a card that way.
 */
function checkLibraryArrivals(
  views: readonly [TableView, TableView],
  previous: PositionMemo,
  at: string,
  add: Add,
): void {
  for (const seat of SEAT_IDS) {
    const other: SeatId = seat === 0 ? 1 : 0;
    const gone = previous.librarySize[seat] - views[seat].seats[seat].librarySize;
    if (gone <= 0) continue;
    const seen = previous.identified[seat];
    const arrived = heldBy(views, seat).filter((object) => !seen.has(object.oid));
    if (arrived.length !== gone) continue;
    for (const card of arrived) {
      if (previous.wire[other].includes(JSON.stringify(card.oid))) {
        add(
          `${at}: object ${card.oid} came out of seat ${String(seat)}'s library and seat ${String(other)}'s payload named it one move earlier`,
        );
      }
    }
  }
}

/**
 * Every object this log says `viewer` may identify — the fold of the deltas, over
 * the whole log rather than only its newest entry.
 *
 * `EngineEvent.reveals` is read as a field, not decoded out of `detail`. That is
 * the difference between this and what it replaced: the old version matched
 * `event.type === 'handRevealed'` and a `{ player, oids }` payload, which is one
 * engine's vocabulary, so a backend that showed a hand under any other name got
 * no license and was reported as leaking one card per position for the rest of
 * the game. Nothing here now knows what a reveal is called, which is what makes
 * the relief available to a backend this file has never met.
 *
 * Scoped by who may identify the object rather than by whose zone it came out
 * of. That is stricter than the owner-scoping it replaces and for the same
 * reason: a reveal made to one seat must not quiet a leak in the other seat's
 * payload, and `EngineReveal.seats` says which seats outright instead of leaving
 * it to be inferred from an owner.
 */
function revealedTo(events: readonly EngineEvent[], viewer: SeatId): ReadonlySet<string> {
  const oids = new Set<string>();
  for (const event of events) {
    for (const reveal of event.reveals) {
      if (reveal.seats.includes(viewer)) oids.add(reveal.oid);
    }
  }
  return oids;
}

/** Everything one seat holds, over the view that seat is entitled to. */
function heldBy(views: readonly [TableView, TableView], seat: SeatId): readonly ObjectView[] {
  const view = views[seat];
  const own = view.seats[seat];
  return [
    ...(own.hand ?? []),
    ...own.graveyard,
    ...own.battlefield,
    ...view.stack.filter((object) => object.controller === seat),
  ];
}

/** Every object id one seat could identify in this position, from its own view. */
function identifiedIn(view: TableView): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const object of objectsIn(view)) seen.add(object.oid);
  return seen;
}

type Add = (detail: string) => void;

/**
 * The two seat views and the table's own describe one position.
 *
 * Everything compared here is public by CR 400.2 — the board, the graveyards,
 * the stack, life, and the counts of the hidden zones — so all three values must
 * agree about it. A per-seat projection that quietly reports a different board is
 * the failure this catches, and it is a worse one than a leak: both players would
 * be playing a game the server is not running.
 */
function checkPublicAgreement(
  table: TableView,
  views: readonly [TableView, TableView],
  at: string,
  add: Add,
): void {
  const shapes = [table, ...views].map(publicShape);
  const [expected] = shapes;
  const names = ['the table view', "seat 0's view", "seat 1's view"];
  shapes.forEach((shape, index) => {
    if (shape !== expected) add(`${at}: ${names[index] ?? 'a view'} disagrees about the public position`);
  });
}

/** Everything in a view that every seat is entitled to, as one comparable string. */
function publicShape(view: TableView): string {
  return JSON.stringify({
    turn: view.turn,
    priority: view.priority,
    stack: view.stack.map(publicObject),
    seats: view.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      life: seat.life,
      handSize: seat.handSize,
      librarySize: seat.librarySize,
      graveyard: seat.graveyard.map(publicObject),
      battlefield: seat.battlefield.map(publicObject),
    })),
  });
}

function publicObject(object: ObjectView): unknown {
  return { oid: object.oid, name: object.name, tapped: object.tapped, damage: object.damage };
}

/** How many objects carry each name, over everything either seat may identify. */
function nameCounts(views: readonly [TableView, TableView]): ReadonlyMap<string, number> {
  const named = new Map<string, string>();
  for (const view of views) {
    for (const object of objectsIn(view)) named.set(object.oid, object.name);
  }
  const counts = new Map<string, number>();
  for (const name of named.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function objectsIn(view: TableView): readonly ObjectView[] {
  return [
    ...view.stack,
    ...view.seats.flatMap((seat) => [...(seat.hand ?? []), ...seat.graveyard, ...seat.battlefield]),
  ];
}
