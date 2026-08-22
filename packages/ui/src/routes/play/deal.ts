/**
 * A card pool to a game a person can sit down at.
 *
 * Deck construction is `@mtg/deckbuild`'s job and the opponent is `@mtg/sim`'s
 * tier-1 greedy bot, so nothing here decides anything about cards or play.
 *
 * The bot used to be the kernel's own `simpleAgent`, on the grounds that
 * `@mtg/sim`'s barrel reaches `node:worker_threads` through the runner and
 * would pull Node built-ins into a browser bundle. That is true of the barrel
 * and of nothing else: `@mtg/sim/bot` is the one module, its whole import
 * closure is sixteen files of arithmetic over `@mtg/kernel` and `@mtg/dsl`, and
 * `vite.config.ts` names the subpath ahead of the catch-all alias so the barrel
 * is never reached. What the swap buys is the reason `@mtg/sim` exists: three
 * plays reported from live games on 2026-08-19 — a removal spell cast at its
 * own creature with nothing else on the board, a 4/5 sent in past a board of
 * menace creatures that left one blocker home unable to block any of them, and
 * a 1/1 and a 2/1 double-blocking a 3/1 first striker that kills both and takes
 * nothing back — are all decisions `simpleAgent` is documented as not making
 * well, and all three are already policies here (`policies/cast.ts`'s
 * `ownGoalPenalty`, `policies/attack.ts`'s `holdBackBlockers`, `evaluate.ts`'s
 * `resolveExchange`, which reads first strike on both bodies).
 *
 * `simpleAgent` keeps its job, which is proving the kernel plays a game through
 * without depending on anything downstream. This is a play surface, and a
 * person sitting at it is owed the opponent the project actually has.
 *
 * `opponent: 'human'` seats a second person there instead, which is the whole of
 * what a hotseat game needs from this layer: a session already stops on
 * whichever seat owes the next decision, and the board already draws the seat it
 * stopped on.
 */
import type { Card } from '@mtg/dsl';
import { buildDeck, buildPrecon, openCollatedPool, openSealedPool } from '@mtg/deckbuild';
import type { PackCollation, PreconDeck } from '@mtg/deckbuild';
import type { Choice, DeckList, GameSetup, PlayerId, Seat } from '@mtg/kernel';
import { botSeat, humanSeat } from '@mtg/kernel';
import { greedyBot } from '@mtg/sim/bot';
import type { SeatNames } from './position';
import type { PlayConfig } from './use-session';

/** Who answers the seat across the table. */
export type OpponentKind = 'bot' | 'human';

export interface DealOptions {
  readonly seed?: string;
  readonly youName?: string;
  readonly opponentName?: string;
  /** Which seat the person sits in. Seat 0 is on the play. */
  readonly viewer?: PlayerId;
  /**
   * `'human'` seats a second person at the same screen instead of a bot. The
   * kernel needs nothing else for it: a session stops on whichever seat owes the
   * next decision, so two human seats simply stop twice as often.
   */
  readonly opponent?: OpponentKind;
  /** Resumes a recorded game. */
  readonly choices?: readonly Choice[] | undefined;
  /** Names the deck at the table, where the caller has a name worth showing. */
  readonly deckName?: string;
  /**
   * The printing's own sheets, when the staged set carried them.
   *
   * Read by `dealSealedGame` alone, and it has to be: the seat across the table
   * opens its own six packs, and opening them from the rarity recipe while the
   * person opened theirs from the printing's collation would seat two players in
   * two different formats. Every other deal here starts from a finished list.
   */
  readonly collation?: PackCollation;
}

export interface DealtGame {
  readonly config: PlayConfig;
  readonly deck: DeckList;
}

interface Seating {
  readonly seats: readonly [Seat, Seat];
  /** Indexed by seat, so a label does not change when the viewer does. */
  readonly names: SeatNames;
}

/**
 * The two seats and their names, in seat order.
 *
 * The defaults track who is actually sitting there: calling a second person
 * "Bot" would be a plain lie, and "You" stops meaning anything once the screen
 * is shared, so a hotseat game names the seats rather than the viewer.
 */
function seating(options: DealOptions, viewer: PlayerId): Seating {
  const opponent = options.opponent ?? 'bot';
  const hotseat = opponent === 'human';
  const youName = options.youName ?? (hotseat ? 'Player one' : 'You');
  const opponentName = options.opponentName ?? (hotseat ? 'Player two' : 'Bot');
  const you: Seat = humanSeat(youName);
  const them: Seat = hotseat ? humanSeat(opponentName) : botSeat(greedyBot(opponentName));
  return viewer === 0
    ? { seats: [you, them], names: [youName, opponentName] }
    : { seats: [them, you], names: [opponentName, youName] };
}

/**
 * Builds one deck from the pool and seats a person opposite an opponent playing
 * the same list.
 *
 * A mirror is the honest default for "here is a set, let me play it": both
 * seats face identical cards, so a game that feels lopsided is the set talking
 * rather than the pairing. Sealed (`mtg-bc2.38.3`) is where the two seats stop
 * being the same list. It is also the only shape a hotseat game can take today
 * without lying to somebody, since nothing here asks the second person to build
 * a deck.
 */
export function dealMirrorGame(pool: readonly Card[], options: DealOptions = {}): DealtGame {
  const built = buildDeck(pool);
  const deck: DeckList = { name: built.colorPair.join(''), cards: built.deck };
  const setup: GameSetup = {
    seed: options.seed ?? 'lab/play/v0',
    decks: [deck, deck],
  };
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  return {
    deck,
    config: {
      setup,
      seats,
      viewer,
      names,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}

/**
 * Seats a person's sealed deck opposite a bot that opened its own packs.
 *
 * The opponent gets a real sealed pool from the same set rather than a copy of
 * the player's deck, because that is what sealed is: two people open six packs
 * and build whatever they got. Its seed is derived from the game seed, so the
 * whole match, both pools included, still reproduces from one string.
 *
 * `opponent: 'human'` works here, but the second person inherits a deck built
 * for them out of that pool rather than building their own. Sealed for two
 * people wants a second builder screen, and that is a product question this
 * function has no business answering on its own.
 */
export function dealSealedGame(
  playerDeck: readonly Card[],
  set: readonly Card[],
  options: DealOptions = {},
): DealtGame {
  const seed = options.seed ?? 'lab/sealed/v0';
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  const other: PlayerId = viewer === 0 ? 1 : 0;

  const opponentSeed = `${seed}/opponent`;
  const opponentPool =
    options.collation === undefined
      ? openSealedPool(set, { seed: opponentSeed })
      : openCollatedPool(set, options.collation, { seed: opponentSeed });
  const opponentBuild = buildDeck(opponentPool.cards);

  // Deck names off the seat-indexed labels, which is the same string either
  // way: `names[viewer]` is whoever the pool was built for by construction.
  const yours: DeckList = { name: `${names[viewer]} sealed`, cards: playerDeck };
  const theirs: DeckList = { name: `${names[other]} sealed`, cards: opponentBuild.deck };
  const setup: GameSetup = {
    seed,
    decks: viewer === 0 ? [yours, theirs] : [theirs, yours],
  };

  return {
    deck: yours,
    config: {
      setup,
      seats,
      viewer,
      names,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}

/**
 * Seats a built Constructed deck opposite the same list.
 *
 * A mirror, for `dealMirrorGame`'s reason and one more. Constructed has no pool
 * to open a second deck out of: sealed can deal the opponent six packs of the
 * same set because that is what sealed *is*, and there is no equivalent gesture
 * here — the alternative would be `buildDeck` over the whole set, which is a
 * pile nobody designed and would tell you nothing about the deck you just built.
 * Facing your own list does: a game that feels lopsided is the deck talking.
 *
 * `opponent: 'human'` carries no caveat, unlike sealed's, because both seats get
 * the identical finished deck rather than one built for somebody who never got
 * to build it.
 */
export function dealConstructedGame(playerDeck: readonly Card[], options: DealOptions = {}): DealtGame {
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  const deck: DeckList = { name: options.deckName ?? 'Your deck', cards: playerDeck };
  return {
    deck,
    config: {
      setup: { seed: options.seed ?? 'lab/constructed/v0', decks: [deck, deck] },
      seats,
      viewer,
      names,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}

/** Seats two finished 40-card decks from one draft pod. */
export function dealDraftGame(
  playerDeck: readonly Card[],
  opponentDeck: readonly Card[],
  options: DealOptions = {},
): DealtGame {
  const seed = options.seed ?? 'lab/draft/v0';
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  const yours: DeckList = { name: 'Your draft', cards: playerDeck };
  const theirs: DeckList = { name: 'Bot draft', cards: opponentDeck };
  return {
    deck: yours,
    config: {
      setup: { seed, decks: viewer === 0 ? [yours, theirs] : [theirs, yours] },
      seats,
      viewer,
      names,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}

/**
 * Seats two written decks opposite each other.
 *
 * **Two precons, not a precon against a built pile**, and the reason is what a
 * precon is for. `buildDeck` over a whole set produces a deck nobody designed:
 * a game against it says nothing about whether the written plan works, because
 * the other half of the table has no plan to lose to. Four authored decks
 * playing each other is also the product — the person who owns them owns all
 * four, and the second seat is either a bot holding one of the other three or
 * the other person at the table holding it. `opponent: 'human'` therefore
 * works here with no caveat at all, which is the one thing `dealSealedGame`
 * cannot say: both seats get a finished, equal, authored deck.
 *
 * `buildPrecon` refuses an id the set does not print, so a stale list fails
 * here by name rather than dealing a short deck.
 *
 * Seeding is `dealSealedGame`'s exactly: one string names the whole table.
 * There is one fewer thing to derive, because neither deck is opened from a
 * pool — the lists are fixed, so seed plus the two deck ids plus `choices` is
 * the entire record of a game.
 */
export function dealPreconGame(
  yourDeck: PreconDeck,
  theirDeck: PreconDeck,
  set: readonly Card[],
  options: DealOptions = {},
): DealtGame {
  const seed = options.seed ?? 'lab/precon/v0';
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);

  // Named for the deck rather than the seat: a precon's name is the thing a
  // person picked, and "Bot" over a list called Down in the Gloom would hide
  // the only fact about that seat worth knowing. The seat's own name is still
  // what the board and the rail say, through `names`.
  const yours: DeckList = { name: yourDeck.name, cards: buildPrecon(yourDeck, set).deck };
  const theirs: DeckList = { name: theirDeck.name, cards: buildPrecon(theirDeck, set).deck };
  const setup: GameSetup = {
    seed,
    decks: viewer === 0 ? [yours, theirs] : [theirs, yours],
  };

  return {
    deck: yours,
    config: {
      setup,
      seats,
      viewer,
      names,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}
