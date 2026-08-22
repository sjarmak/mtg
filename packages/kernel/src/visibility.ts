/**
 * What one seat is allowed to see of a position.
 *
 * # Why this is in the kernel and not in the viewer
 *
 * `@mtg/ui`'s `routes/play/position.ts` already draws the opponent's hand as a
 * count of face-down cards, and its docblock states the rule it applies. That is
 * a *projection*: it holds the whole `GameState` and declines to draw part of
 * it. Between two people at one screen that is honest, because they are looking
 * at the same pixels. Across a network it is not concealment at all — the client
 * holds the bytes, and the opponent's hand is one devtools panel away.
 *
 * So the thing that had to move to the server was never the projection. Three
 * reasons, in the order they bind:
 *
 *  1. **The projection produces presentation, not a position.** `boardPosition`
 *     returns board props: slot counts, accessible labels, a resolved
 *     illustration per card. Art is staged into the page that draws it and the
 *     server has never heard of it, so a server that produced board props would
 *     have to own the art pipeline to produce them.
 *  2. **The projection is not the only reader.** `prompt.ts`, `cast.ts`,
 *     `selection.ts` and the game log all read the same `GameState`. Moving one
 *     of them across the wire would leave the other four needing the full state,
 *     so the leak would survive the move.
 *  3. **The rule is a rule of the game.** CR 400.2 divides the six zones into
 *     hidden and public. The kernel owns zones. A visibility rule kept anywhere
 *     else is a second opinion about what a zone is.
 *
 * `seatState` therefore *removes* what a seat may not see, and every existing
 * projection keeps working on top of it unchanged — including `position.ts`,
 * whose own hiding is now belt and braces rather than the only guard. A hot-seat
 * game still hands it the full state and still relies on it; a networked game
 * hands it a state that no longer contains the answer.
 *
 * # What a seat may not see
 *
 * A card's identity lives in both `GameState.objects` and the stable object id
 * held by a zone list. Concealment therefore does two things: drop the object
 * and replace each concealed zone entry with a projection-local placeholder.
 * The arrays keep their length, which is what a hand count and library count
 * are drawn from, but a later snapshot receives different placeholders. A
 * face-down position cannot become a tracking tag for the card that occupied it.
 *
 *  - **Both libraries**, including the viewer's own. Knowing your own next draw
 *    is the same information leak wearing a friendlier face.
 *  - **The other seat's hand.**
 *
 * Everything else in `GameState` is public and stays: the battlefield, both
 * graveyards, exile, the stack, life totals, mana pools, combat, the step.
 *
 * Two fields are cleared rather than concealed, because they are oracles for
 * everything above:
 *
 *  - `rng`, which is the generator every future shuffle draws from.
 *  - `config.seed`, which with the two decklists reproduces the entire game.
 *    Neither decklist is public in a sealed match, so the seed alone reveals
 *    nothing; clearing it costs nothing and closes the door anyway.
 *
 * # Identity is judged by where a card is now
 *
 * A spell that was cast, countered and returned to its owner's hand reads as "a
 * card" again, even though the opponent watched it go on the stack. That is a
 * loss of information the opponent is entitled to, not a leak, and closing it
 * needs a per-seat record of what each player has already seen — a knowledge log
 * the model does not have, one zone over from the reason `GameState.exile` is a
 * single global list (`mtg-q3d`). The conservative direction is the safe one to
 * be wrong in.
 *
 * It is safe here and not in the *log*, which is cumulative and therefore too
 * loose at the same position this is too strict at. `publiclyIdentified` below
 * is the half of that record the reducer can already state without holding it:
 * per event, which objects were in a public zone when they moved out of one.
 * `GameState` still carries no knowledge relation, so `seatState` above is
 * unchanged and a bounced card still reads as "a card" to the projector.
 *
 * # This is never fed back into the kernel
 *
 * A concealed state is a value to *look at*. Reducing one would produce a game
 * that diverges from the real one on the first draw, because the objects it
 * would draw are gone and the generator that orders them is zeroed. Nothing in
 * this package calls `seatState` — `packages/kernel/test/visibility.test.ts`
 * asserts that by reading the tree, so it cannot reach `reduce`, `fork`,
 * `stateFingerprint` or the replay path by accident.
 */
import { assertNever } from '@mtg/dsl';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import type { RngState } from './rng';
import type { GameObject, GameState, ZoneId } from './state';

/** CR 400.2: the zones whose contents are not revealed to both players. */
export const HIDDEN_ZONES: readonly ZoneId[] = ['library', 'hand'];

export function isHiddenZone(zone: ZoneId): boolean {
  return HIDDEN_ZONES.includes(zone);
}

/**
 * The generator a concealed state carries.
 *
 * Zeroed rather than omitted, so the value is still a `GameState` a viewer can
 * be written against without every field access learning about concealment.
 */
const CONCEALED_RNG: RngState = { a: 0, b: 0, c: 0, d: 0 };

/**
 * Every object id this seat may not identify: both libraries, and the other
 * seat's hand.
 *
 * Read off the zone lists rather than off each object's own `zone` field. The
 * two agree, and the zone lists are what a viewer counts, so deriving
 * concealment from the same arrays the count comes from means a disagreement
 * between them cannot show up as a card leaking.
 */
export function concealedFrom(state: GameState, viewer: PlayerId): ReadonlySet<ObjectId> {
  const concealed = new Set<ObjectId>();
  for (const player of state.players) {
    for (const oid of player.library) concealed.add(oid);
    if (player.id === viewer) continue;
    for (const oid of player.hand) concealed.add(oid);
  }
  if (state.pendingScry?.player === viewer) {
    for (const oid of state.pendingScry.cards) concealed.delete(oid);
  }
  // CR 701.19a: a search shows the searching player their whole library, and
  // `PendingSearch.cards` is the part of it the filter matched — the only part
  // a decision can name. Un-concealing exactly that list rather than the whole
  // library is not a rules nicety, it is what keeps the leak surface equal to
  // the decision surface: an id this seat cannot choose is an id it has no
  // reason to hold, and the other seat's library is never in this list because
  // `awaitSearch` reads the searcher's own.
  if (state.pendingSearch?.player === viewer) {
    for (const oid of state.pendingSearch.cards) concealed.delete(oid);
  }
  // CR 701.16a: a `chooseDiscard` showed the hand to both players before asking
  // anybody anything, and the reveal is what entitles the chooser to identify
  // cards in a zone that is not theirs. The `revealed` guard is the whole of
  // that entitlement — without a reveal the seat being asked is the hand's
  // owner, whose own cards were never in this set, so the guard costs nothing
  // there and is the only thing standing between a chooser and an opponent's
  // hand in every other case a future effect might reach this record with.
  if (state.pendingHandDiscard?.player === viewer && state.pendingHandDiscard.revealed) {
    for (const oid of state.pendingHandDiscard.cards) concealed.delete(oid);
  }
  return concealed;
}

/**
 * The position as one seat may see it: the same state with every card it is not
 * entitled to identify removed, and the two oracles for the rest cleared.
 *
 * Same shape as its input on purpose. Every projection already written against
 * `GameState` reads this without knowing it has been through here, which is what
 * makes moving a surface behind a wire a change of address rather than a rewrite.
 * `key` identifies one delivery, not one game object. A network table keeps it
 * stable while the revision is unchanged and replaces it after every move, so a
 * reconnect can redraw the same payload without making the placeholders useful
 * as card identities across positions.
 */
function concealedId(key: string, scope: string): ObjectId {
  return `concealed:${key}:${scope}`;
}

function projectedZone(
  ids: readonly ObjectId[],
  concealed: ReadonlySet<ObjectId>,
  key: string,
  scope: string,
): readonly ObjectId[] {
  return ids.map((oid, index) => (concealed.has(oid) ? concealedId(key, `${scope}:${String(index)}`) : oid));
}

export function seatState(state: GameState, viewer: PlayerId, key: string): GameState {
  const concealed = concealedFrom(state, viewer);
  const objects: Record<ObjectId, GameObject> = {};
  for (const [oid, object] of Object.entries(state.objects)) {
    if (!concealed.has(oid)) objects[oid] = object;
  }
  const players = state.players.map((player) => ({
    ...player,
    library: projectedZone(player.library, concealed, key, `seat:${String(player.id)}:library`),
    hand: projectedZone(player.hand, concealed, key, `seat:${String(player.id)}:hand`),
  })) as [GameState['players'][0], GameState['players'][1]];
  const projected: GameState = {
    ...state,
    objects,
    players,
    rng: CONCEALED_RNG,
    config: { ...state.config, seed: '' },
  };
  const asked = state.turn.awaitingPlayer;
  // A discard or a bottoming answered one card at a time names cards in the
  // chooser's own hand (`state.ts`'s `pendingSelection`), which the seat that is
  // not being asked may not identify. Concealing the whole field rather than
  // placeholding it is deliberate: a placeholder would still tell that seat how
  // many cards have been named, and how far into a discard an opponent has got
  // is not a fact the rules give it either.
  const seen = asked === viewer ? projected : withoutSelection(projected);
  const withoutScry = state.pendingScry?.player === viewer ? seen : withoutPendingScry(seen);
  const withoutSearch =
    state.pendingSearch?.player === viewer ? withoutScry : withoutPendingSearch(withoutScry);
  return state.pendingHandDiscard?.player === viewer
    ? withoutSearch
    : withoutPendingHandDiscard(withoutSearch);
}

function withoutSelection(state: GameState): GameState {
  if (state.pendingSelection === undefined) return state;
  const { pendingSelection: _named, ...concealed } = state;
  return concealed;
}

function withoutPendingScry(state: GameState): GameState {
  const { pendingScry: _concealed, ...concealed } = state;
  return concealed;
}

/**
 * The searcher's matching cards, gone for the seat that is not searching.
 *
 * Stripped whole rather than placeholded, for `withoutSelection`'s reason one
 * zone over: a placeholder list would still tell the opponent *how many* cards
 * in a library match "a Forest card", and the size of a hidden zone's matching
 * subset is not a fact CR 701.19a gives them either.
 */
function withoutPendingSearch(state: GameState): GameState {
  const { pendingSearch: _concealed, ...concealed } = state;
  return concealed;
}

/**
 * The discard in progress, gone for the seat that is not choosing.
 *
 * Stripped from the hand's *owner* too, under a `chooseDiscard` where the owner
 * is watching their own revealed hand be picked over. That looks like
 * over-concealment and is not: `handRevealed` already told them exactly which
 * cards were shown, and it went through `seatEvent` unredacted, so the fact is
 * in their log. What this record adds is the shape of a decision they do not
 * owe, and a seat holding a pending question addressed to somebody else is how
 * a surface ends up drawing a prompt for the wrong player.
 */
function withoutPendingHandDiscard(state: GameState): GameState {
  const { pendingHandDiscard: _concealed, ...concealed } = state;
  return concealed;
}

/**
 * The log as one seat may read it.
 *
 * State redaction is not enough. A stable id on `cardDrawn`, `handKept`, or a
 * move into a concealed zone can be joined to a later public event after that
 * card is played or revealed. Those private ids become event-local placeholders
 * under the same delivery key as the state, and deliberately do not match the
 * concealed-zone placeholders. The opponent still learns the public fact and
 * count without receiving a card-tracking handle.
 *
 * The seed also carries something no object holds. `gameStarted` records it,
 * and the seed with the two decklists
 * reproduces every shuffle in the game, so it is the same information as both
 * libraries in four words. It is cleared here for the same reason
 * `GameConfig.seed` is cleared in `seatState`, and the pair of them is why this
 * function must project the whole union rather than wave the log through.
 *
 * **The switch is exhaustive and `assertNever` closes it.** A forty-ninth event
 * member added to the kernel tomorrow fails to compile here rather than
 * defaulting to public and leaking on the first game that emits it. That is the
 * whole reason this is a switch over the union and not a lookup of one type
 * name, and it is the same argument `@mtg/ui`'s `log/visibility.ts` makes about
 * its own switch over the same union — a different question about the same
 * events, asked in the place that can answer it.
 */
export function seatEvent(event: GameEvent, viewer: PlayerId, key: string, index: number): GameEvent {
  const eventId = (slot: string): ObjectId => concealedId(key, `event:${String(index)}:${slot}`);
  switch (event.type) {
    case 'gameStarted':
      return { ...event, seed: '' };
    case 'cardDrawn':
      return event.player === viewer ? event : { ...event, oid: eventId('drawn') };
    case 'zoneChanged':
      return event.owner === viewer || !isHiddenZone(event.to) ? event : { ...event, oid: eventId('moved') };
    case 'handKept':
      return event.player === viewer
        ? event
        : {
            ...event,
            bottomed: event.bottomed.map((_oid, at) => eventId(`bottomed:${String(at)}`)),
          };
    case 'libraryShuffled':
    case 'drawFromEmptyLibrary':
    case 'handMulliganed':
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
    case 'handRevealed':
    case 'libraryTopRevealed':
    case 'librarySearched':
    case 'librarySearchRevealed':
    case 'cardsDiscarded':
    case 'damageCleared':
    case 'playerLost':
    case 'gameEnded':
      // `handRevealed` is the member of this group worth a sentence: it is the
      // one event whose whole purpose is to show a seat something it could not
      // otherwise see, so redacting it would delete the effect rather than
      // protect anything. CR 701.16a says the cards were revealed to all
      // players, and this is where that is honored. `libraryTopRevealed` is
      // the same sentence one zone over (CR 701.16a again), and
      // `librarySearched` is public because it carries no id at all: a boolean
      // saying a search found something, which is what both seats watched
      // happen. `librarySearchRevealed` is the reveal *beside* that boolean and
      // does carry ids — it is here for `handRevealed`'s reason and not for
      // `librarySearched`'s: the card printed "reveal it", so redacting the
      // ids would delete the clause the seat paid for.
      return event;
    default:
      return assertNever(event, 'seatEvent');
  }
}

/**
 * The objects this event put in front of both players, from here on.
 *
 * The companion to `seatEvent` and the answer to the question it cannot ask.
 * `seatEvent` decides whether *this* event may name an id; this decides whether
 * a seat may still identify the object afterwards. The two differ exactly where
 * the log is cumulative: a creature bounced off the battlefield is redacted out
 * of the `zoneChanged` its opponent receives and is still named by the
 * `spellCast` that targeted it three events earlier, so the redaction is correct
 * and useless. What repairs that is a license, not a redactor.
 *
 * **The rule is the zone the object left, not the event's spelling.** An object
 * in a public zone is one CR 400.2 says both players may identify, so an event
 * moving it out of one is evidence that both of them had the chance. That is a
 * fact about the position the reducer was in, which is what makes the entry a
 * consequence of reduction rather than an assertion an emitter chose to make.
 *
 * The narrower alternative was to license whatever an unredacted event names.
 * It is broader, not narrower, and it launders: an arm that should redact and
 * does not would license the very id it leaked, and the audit downstream would
 * go quiet on the bug instead of reporting it. A zone is checkable; "this event
 * named it" is the leak restating itself.
 *
 * **`handRevealed` and `libraryTopRevealed` are the other entries, and they are
 * the ones that need the event.** CR 701.16a shows the cards from a hidden zone
 * without moving them, so no zone change records it; the event is the whole of
 * the effect (`events.ts`), and its `oids` are what was shown. A library reveal
 * is the one effect in the vocabulary that shows a player something about their
 * *own* deck — a library is concealed from both seats including its owner — so
 * without a license here the reveal draws as face-down cards for everyone.
 *
 * `librarySearchRevealed` is a third entry for the same reason, and it is the
 * one place the two search events part company: the reveal names what was
 * shown, so both seats may identify those cards afterwards even though the
 * cards land in a hand. A search *without* the printed reveal emits no such
 * event and licenses nothing, which is the difference between Sylvan Ranger and
 * Rampant Growth drawn on a board.
 *
 * `librarySearched` is deliberately not an entry. It names no object, because a
 * search that found a card publishes it through the `zoneChanged` that moved it
 * (to the battlefield, where CR 400.2 makes it public) or does not publish it at
 * all (to a hand, which stays hidden). Licensing off the boolean would license
 * nothing and read as though it licensed the card.
 *
 * **An arm this does not name reveals nothing, and the default is safe** — which
 * is the asymmetry with `seatEvent`, whose default would leak and is therefore
 * closed by `assertNever`. A missing license costs a false *leak* finding at the
 * seam, which is loud and lands on whoever added the arm. A missing redaction
 * costs a card. So an event added tomorrow that shows a player something has to
 * be added here, and the way that is discovered is a red suite rather than a
 * quiet game.
 *
 * It reveals to *both* seats or to neither, because a public zone is public to
 * both. What one seat alone may learn — the cards under a scry, the order a
 * mulligan bottomed — is not reconstructible from today's stream at all
 * (`cardsScried` carries counts), and reaching it means the reducer keeping the
 * knowledge itself.
 */
export function publiclyIdentified(event: GameEvent): readonly ObjectId[] {
  switch (event.type) {
    case 'handRevealed':
    case 'libraryTopRevealed':
    case 'librarySearchRevealed':
      return event.oids;
    case 'zoneChanged':
      return isHiddenZone(event.from) ? [] : [event.oid];
    default:
      return [];
  }
}

/** The whole log through `seatEvent`, in order. */
export function seatEvents(
  events: readonly GameEvent[],
  viewer: PlayerId,
  key: string,
): readonly GameEvent[] {
  return events.map((event, index) => seatEvent(event, viewer, key, index));
}
