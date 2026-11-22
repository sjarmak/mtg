/**
 * Whether a game can be dealt, for a set kind, a format and an opponent.
 *
 * `mtg-a982g.1`. Every Play section offers the same two columns, *Against a
 * bot* and *Over this network*, and which of the two cells is live depends on
 * what kind of set is staged (a DSL set the kernel runs, a printed format Forge
 * runs, the Legacy Cube), which format the section is, and which opponent the
 * column names. Three surfaces used to answer that with three private rules;
 * this is the one function they all read now, so a cell that goes dark says
 * the same sentence wherever it is drawn.
 *
 * The answer is a value rather than a boolean because a disabled control with
 * no sentence beside it is a control that looks broken. `./OpponentChoice.ts`
 * draws the reason beside the cell, the way the printed pool editor does.
 *
 * # The two params
 *
 * `vs=bot` or `vs=lan` says which column is open. A `table=` or `room=` token
 * is an address at a networked game, so it implies the network column and wins
 * over `vs`, which is what `opponentOf` encodes. `against=<deck id>` is the
 * precon opponent's deck, renamed off `vs` so that one word does not mean a
 * deck on one page and a column on the next. `../../app/router.ts` does not
 * alias the old spelling: a bookmarked `?vs=<deck id>` opens the precon picker
 * with no opponent chosen rather than a wrong one.
 */
import type { SubOf } from '../../app/router';
import type { PrintedFormatRow } from '../../lab/printed-format';

export type Opponent = 'bot' | 'lan';
/** `vs=bot` or `vs=lan`: which column of the choice is open. */
export const VS_PARAM = 'vs';
/** `against=<deck id>`: the precon deck across the table. */
export const AGAINST_PARAM = 'against';

export type SetKind = 'kernel' | 'printed' | 'cube';
export type PlayFormat = SubOf<'play'>;

export type Availability =
  { readonly status: 'ready' } | { readonly status: 'unavailable'; readonly reason: string };

export interface AvailabilityFacts {
  /** The printed index row's own word on what it can deal; only a printed set has one. */
  readonly printed?: PrintedFormatRow['availability'];
  /** Whether this page has somewhere to seat a networked game of this format. */
  readonly lan: Availability;
}

export const READY: Availability = { status: 'ready' };

export const COMMANDER_UNAVAILABLE_REASON = 'Commander is not dealt yet.';
export const MOMIR_UNAVAILABLE_REASON = 'Momir Basic is a printed format; a generated set does not deal it.';
export const PRINTED_DRAFT_UNAVAILABLE_REASON = 'Draft is not available for this printed format.';
export const PRINTED_SEALED_UNAVAILABLE_REASON = 'Sealed is not available for this printed format.';
export const PRINTED_UNLOADED_REASON = 'This printed format has not been read yet.';
export const CUBE_DRAFT_ONLY_REASON =
  'The Legacy Cube is drafted; it deals no sealed pools and ships no decks.';
/** What a page says when it was given no callback to seat a networked game with. */
export const LAN_UNWIRED_REASON = 'This page has nowhere to seat a networked game.';

function unavailable(reason: string): Availability {
  return { status: 'unavailable', reason };
}

/**
 * Which column the params open. A token is an address at a networked game
 * and outranks `vs`; `vs=lan` opens the network column; everything else,
 * including no `vs` at all, is the bot column, which is the default because
 * it is the one that needs nobody else in the room.
 */
export function opponentOf(params: Readonly<Record<string, string>>): Opponent {
  const table = params['table'];
  const room = params['room'];
  if ((table !== undefined && table !== '') || (room !== undefined && room !== '')) return 'lan';
  return params[VS_PARAM] === 'lan' ? 'lan' : 'bot';
}

/**
 * A printed format's two columns.
 *
 * The network column reads `facts.lan` rather than a constant of its own
 * (`mtg-a982g.5`): whether a printed format can be dealt over this network is a
 * fact about what this lab has wired, and the lab says it. It now says it out
 * of what the lab's Forge advertises (`./LanForgeStart.ts`), which is why the
 * two placeholder reasons this used to name are gone rather than reworded.
 */
function printedAvailability(format: PlayFormat, opponent: Opponent, facts: AvailabilityFacts): Availability {
  if (opponent === 'lan') return facts.lan;
  const printed: PrintedFormatRow['availability'] | undefined = facts.printed;
  if (printed === undefined) return unavailable(PRINTED_UNLOADED_REASON);
  if (format === 'draft') {
    return printed.draft === 'available' ? READY : unavailable(PRINTED_DRAFT_UNAVAILABLE_REASON);
  }
  if (format === 'sealed') {
    return printed.sealed === 'available' ? READY : unavailable(PRINTED_SEALED_UNAVAILABLE_REASON);
  }
  return printed.play.status === 'unavailable' ? unavailable(printed.play.reason) : READY;
}

/**
 * The cube's two columns: it is drafted, and nothing else.
 *
 * Commander is one of the formats it does not deal rather than a case of its
 * own, and `CUBE_DRAFT_ONLY_REASON` already says why in the cube's own words;
 * `COMMANDER_UNAVAILABLE_REASON` is the kernel's sentence and said the wrong
 * thing here. Over the network the answer is the lab's (`facts.lan`), for the
 * reason a printed format's is: Forge drafts the cube when the lab advertises
 * it.
 */
function cubeAvailability(format: PlayFormat, opponent: Opponent, facts: AvailabilityFacts): Availability {
  if (format !== 'draft') return unavailable(CUBE_DRAFT_ONLY_REASON);
  return opponent === 'lan' ? facts.lan : READY;
}

/**
 * The one answer every Play section reads. Kernel sets deal every format but
 * Commander and Momir Basic against a bot, and over the network whatever the page can seat;
 * printed formats say for themselves what they open against a bot, and over
 * the network the page answers for them too; the cube is drafted and nothing
 * else.
 */
export function availability(
  setKind: SetKind,
  format: PlayFormat,
  opponent: Opponent,
  facts: AvailabilityFacts,
): Availability {
  if (setKind === 'printed') return printedAvailability(format, opponent, facts);
  if (setKind === 'cube') return cubeAvailability(format, opponent, facts);
  if (format === 'commander') return unavailable(COMMANDER_UNAVAILABLE_REASON);
  if (format === 'momir') return unavailable(MOMIR_UNAVAILABLE_REASON);
  return opponent === 'lan' ? facts.lan : READY;
}
