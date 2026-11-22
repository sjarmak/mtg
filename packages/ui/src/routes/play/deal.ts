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
 * Every deal here seats one person opposite that bot. Two human seats at one
 * screen was an arm of this file once; it survives only as a test fixture
 * (`packages/ui/test/support/two-human.ts`), because a shared screen is not a
 * surface this lab offers.
 */
import type { Card } from '@mtg/dsl';
import { buildDeck, buildPrecon, openCollatedPool, openSealedPool } from '@mtg/deckbuild';
import type { PackCollation, PreconDeck } from '@mtg/deckbuild';
import type { Choice, DeckList, GameSetup, PlayerId, Seat } from '@mtg/kernel';
import { botSeat, humanSeat } from '@mtg/kernel';
import { greedyBot } from '@mtg/sim/bot';
import type { SeatNames } from './position';
import { rollForFirst } from './opening-roll';
import type { PlayConfig } from './use-session';

export interface DealOptions {
  readonly seed?: string;
  readonly youName?: string;
  readonly opponentName?: string;
  /** Which seat the person sits in. Seat 0 is on the play. */
  readonly viewer?: PlayerId;
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

/** The two seats and their names, in seat order: the person, and the bot. */
function seating(options: DealOptions, viewer: PlayerId): Seating {
  const youName = options.youName ?? 'You';
  const opponentName = options.opponentName ?? 'Bot';
  const you: Seat = humanSeat(youName);
  const them: Seat = botSeat(greedyBot(opponentName));
  return viewer === 0
    ? { seats: [you, them], names: [youName, opponentName] }
    : { seats: [them, you], names: [opponentName, youName] };
}

function dealt(
  deck: DeckList,
  setup: GameSetup,
  options: DealOptions,
  viewer: PlayerId,
  seated: Seating,
): DealtGame {
  const openingRoll = rollForFirst(setup.seed);
  return {
    deck,
    config: {
      setup: { ...setup, startingPlayer: openingRoll.winner },
      seats: seated.seats,
      viewer,
      names: seated.names,
      openingRoll,
      ...(options.choices === undefined ? {} : { choices: options.choices }),
    },
  };
}

/**
 * Builds one deck from the pool and seats a person opposite an opponent playing
 * the same list.
 *
 * A mirror is the honest default for "here is a set, let me play it": both
 * seats face identical cards, so a game that feels lopsided is the set talking
 * rather than the pairing. Sealed (`mtg-bc2.38.3`) is where the two seats stop
 * being the same list.
 *
 * **It is a test helper, and it is the suite's dealer of record.** `mtg-bc2.96`.
 * No surface calls it and none should: it takes a raw card pool and builds one
 * deck out of it, which is a fixture shape rather than a screen's, and every
 * route that seats a person has a pool or a list of its own to deal from --
 * `SealedGame` through `dealSealedGame`, `ConstructedGame` through
 * `dealConstructedGame` and `dealDeckMatch`. What it is very good at is putting
 * a board on the screen in one line from `EXAMPLE_CARDS`, which is why most of
 * the play and log suites reach for it and why it is not deleted. So it stays
 * here and is exported from neither `./index.ts` nor the package root: the
 * tests import it from this file by path, and a public API is a promise to
 * somebody outside.
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
  return dealt(deck, setup, options, viewer, { seats, names });
}

/**
 * The seed the seat across the table opens its six packs from.
 *
 * One derivation, exported, so that anything else naming the opponent's pool
 * (a test, a report) spells it the way the deal does; two spellings would deal
 * the opposite seat two different pools at one seed, and the seed would stop
 * being an account of the match.
 */
export function opponentPoolSeed(seed: string): string {
  return `${seed}/opponent`;
}

/**
 * The deck the seat across the table plays, built out of its own six packs.
 *
 * `{ set }` and not the opened pool: `@mtg/deckbuild` backs the mana base with
 * the set's own printed basics, and six boosters are not the set. See
 * `sealed.ts`'s `SealedBuild.set` for what the pool finds instead.
 */
function sealedOpponentDeck(set: readonly Card[], options: DealOptions, seed: string): readonly Card[] {
  const opponentSeed = opponentPoolSeed(seed);
  const pool =
    options.collation === undefined
      ? openSealedPool(set, { seed: opponentSeed })
      : openCollatedPool(set, options.collation, { seed: opponentSeed });
  return buildDeck(pool.cards, { set }).deck;
}

/**
 * Seats a person's sealed deck opposite a second sealed deck from the same set.
 *
 * The opponent gets a real sealed pool from the same set rather than a copy of
 * the player's deck, because that is what sealed is: two people open six packs
 * and build whatever they got. Its seed is derived from the game seed, so the
 * whole match, both pools included, still reproduces from one string. The
 * pool is opened here and `buildDeck` answers for the seat, so the bot plays a
 * deck a person could have built rather than a different sealed game.
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

  // Deck names off the seat-indexed labels, which is the same string either
  // way: `names[viewer]` is whoever the pool was built for by construction.
  const yours: DeckList = { name: `${names[viewer]} sealed`, cards: playerDeck };
  const theirs: DeckList = { name: `${names[other]} sealed`, cards: sealedOpponentDeck(set, options, seed) };
  const setup: GameSetup = {
    seed,
    decks: viewer === 0 ? [yours, theirs] : [theirs, yours],
  };

  return dealt(yours, setup, options, viewer, { seats, names });
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
 */
export function dealConstructedGame(playerDeck: readonly Card[], options: DealOptions = {}): DealtGame {
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  const deck: DeckList = { name: options.deckName ?? 'Your deck', cards: playerDeck };
  return dealt(deck, { seed: options.seed ?? 'lab/constructed/v0', decks: [deck, deck] }, options, viewer, {
    seats,
    names,
  });
}

/** One built deck at a seat: the list, under the name its builder gave it. */
export interface MatchDeck {
  readonly name: string;
  readonly cards: readonly Card[];
}

/**
 * Seats two decks somebody built opposite each other.
 *
 * `dealConstructedGame` above seats a built list opposite itself, and its
 * docblock says why: "Constructed has no pool to open a second deck out of", so
 * facing your own list is the only honest game a lone deck can be given. **That
 * premise stopped being true when the workbench got a shelf.** Seven finished,
 * designed decks sit on it, and two of them opposite each other is exactly the
 * case `dealPreconGame` below exists for, with the shelf standing in for the
 * set's written decks — the second seat has a plan to lose to.
 *
 * So this is a second dealer rather than a flag on the first. The mirror is
 * still right for a deck built in the builder with nothing behind it, and the
 * two answer different questions: a mirror asks whether the deck is any good,
 * and a match asks which of two decks is better.
 *
 * Seeding is `dealPreconGame`'s: one string names the whole table, and neither
 * deck is opened from a pool, so seed plus the two lists plus `choices` is the
 * entire record of a game.
 */
export function dealDeckMatch(yours: MatchDeck, theirs: MatchDeck, options: DealOptions = {}): DealtGame {
  // An empty list is a deck that lost every card to a pool that no longer holds
  // them. Dealing it seats a player who draws nothing and loses to decking on
  // the first turn, which reads as a rules bug rather than as the reopen having
  // failed. Named, because the repair is to rebuild that deck.
  for (const deck of [yours, theirs]) {
    if (deck.cards.length === 0) {
      throw new Error(`${deck.name} has no cards to deal; rebuild it against the staged pool`);
    }
  }

  const seed = options.seed ?? 'lab/match/v0';
  const viewer: PlayerId = options.viewer ?? 0;
  const { seats, names } = seating(options, viewer);
  const mine: DeckList = { name: yours.name, cards: yours.cards };
  const other: DeckList = { name: theirs.name, cards: theirs.cards };

  return dealt(mine, { seed, decks: viewer === 0 ? [mine, other] : [other, mine] }, options, viewer, {
    seats,
    names,
  });
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
  return dealt(yours, { seed, decks: viewer === 0 ? [yours, theirs] : [theirs, yours] }, options, viewer, {
    seats,
    names,
  });
}

/**
 * Seats two written decks opposite each other.
 *
 * **Two precons, not a precon against a built pile**, and the reason is what a
 * precon is for. `buildDeck` over a whole set produces a deck nobody designed:
 * a game against it says nothing about whether the written plan works, because
 * the other half of the table has no plan to lose to. Four authored decks
 * playing each other is also the product — the person who owns them owns all
 * four, and the second seat is a bot holding one of the other three: both
 * seats get a finished, equal, authored deck.
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

  return dealt(yours, setup, options, viewer, { seats, names });
}
