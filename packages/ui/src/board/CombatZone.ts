/**
 * The seam, holding the creatures that are fighting over it.
 *
 * The playtester, 2026-08-14: "when a card is attacking instead of 'ATK' label they
 * should be moved to that middle combat zone area that's what that brownish
 * orangeish bar area is supposed to be for". The bar is `.mtg-board__divider`,
 * and `../styles/board/band.ts` already called it "the seam … A bar, not a
 * keyline" — the intent was written down and the space was not. This is the
 * space: the same element, the same ground, growing from a bar into a band when
 * it has something to hold and collapsing back to a bar when it does not.
 *
 * **Nothing in the references does this, and that is worth saying before the
 * rest.** `docs/research/prior-art-board-layout.md` describes no combat layout
 * for any of the four clients — no attacker migration, no blocker adjacency, no
 * shared-versus-per-seat statement, no arrows. The two Magic Online captures in
 * `references/` that reach the attack step (`maxresdefault-80883895.jpg`,
 * `mtgo-gameplay-1-3365682711.jpg`) both freeze on "waiting for … to declare
 * attackers", and their middle band is empty: 42px against a 94px card, 5.8% of
 * the window, physically unable to hold a card at any rotation. Magic Online's
 * answer is the opposite one — it orders each seat's rows so that *creatures sit
 * nearest the divider*, and an attacker never moves at all. So the arrangement
 * below is ours. It is built because the person who plays this asked for it, and
 * the claim "every client does this" is one nobody should repeat.
 *
 * **One band, shared, entered from the side that declared.** Both seats attack
 * across the same seam and only one of them attacks per turn, so two bands would
 * be one empty band every turn of every game. Which seat an attacker came from
 * is drawn as a strip of that seat's own paper along the edge of the card
 * nearest its half — `--mtg-mat-band-far` on the top of theirs, `-near` on the
 * bottom of yours — which is the one color on the mat that already means "this
 * half". It is not a label and it is not readable by a screen reader, so the
 * card also carries the sentence (`./Battlefield.ts`, `attackingMark`).
 *
 * **Staged and declared are different things and are drawn differently.** A
 * staged attacker is a proposal the kernel has never heard of: it is drawn
 * smaller, hanging off the edge of the band nearest its own seat, ringed in
 * `--mtg-ready` — the same three channels every other "you may act on this"
 * state on this table spends (`../styles/board/slot.ts`). A declared attacker
 * fills the band. Moving up into the band and then filling it is the whole of
 * the visual difference between "I am thinking about it" and "I have said it".
 *
 * **A blocker moves too, and it moves next to what it blocks.** CR 509.1a makes
 * a block an assignment to one specific attacker, so a blocker that entered a
 * shared band without landing beside its attacker would make the band mean less
 * than it does now. That is why the strip is a list of entries rather than a flat
 * row of cards: `pairEntries` puts each staged blocker immediately after the
 * attacker it answers, and the pair reads left to right the way the sentence
 * does.
 *
 * **Adjacency alone was not enough, and `mtg-7all` is where it stopped being
 * enough.** With one attacker it is unambiguous. With three attackers and one
 * blocker each the row reads attacker, blocker, attacker, blocker, and the only
 * channels saying which pairs with which are the height, the seat strip and the
 * amber ring - three channels that all say "this is a staged blocker" and none
 * that says "of that one". So the pair is drawn inside a keylined tray with a
 * connector between the two cards, which is the drawing
 * `../styles/board/attach.ts` already uses for an Equipment and its creature:
 * same vocabulary, same reason, one relation a player reads instead of infers.
 * An attacker nobody has answered is the bare entry it always was, so
 * declare-attackers draws exactly what it drew before.
 *
 * Both halves move. A *staged* block — a declaration the player is assembling —
 * is drawn in exactly the three channels a staged attacker gets (short of the
 * band, hanging off its own seat's edge, ringed in `--mtg-ready`). A block the
 * engine has taken (`blockingKeys`, filled from the projection for both seats)
 * fills the band beside its attacker in the same tray, because a declared block
 * that left the blocker in its row was the one pairing on the table that had to
 * be worked out by reading two rows and a badge (`mtg-31b0r`): the other seat
 * never staged anything, so for them the declared drawing is the only one.
 * Adjacency is invisible to a screen reader, so the blocker also carries the
 * sentence (`./Battlefield.ts`, `stagedBlockMark` and `blockingMark`).
 *
 * **The band owns no game state.** Everything it draws is read off props the
 * projection already fills from `GameState.combat`, and the one thing that is
 * not — which creatures the player has staged — is view state that never reaches
 * the kernel. Seed plus `choices` is still the entire record.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { isLand } from '@mtg/dsl';
import type { BattlefieldProps, BoardPermanent, PermanentGroup } from './Battlefield';
import { groupAttachments, groupNode, groupPermanentPiles, permanentPileNode } from './Battlefield';
import type { BoardSeat, BoardSide } from './Board';

/** What the seam says it is, for a reader who cannot see where a card sits. */
export const COMBAT_ZONE_LABEL = 'Combat';

/** A group in the band, and which half of the table it came from. */
interface CombatEntry {
  readonly seat: BoardSeat;
  readonly group: PermanentGroup;
}

/** The two seats with their attackers taken out, and the band holding them. */
export interface CombatTable {
  readonly opponent: BoardSide;
  readonly you: BoardSide;
  readonly band: ReactElement;
}

/**
 * The attackers a blocker is answering, by key: the block it is assembling, or
 * failing that the one the engine has taken. Never both, since a declared block
 * is not a decision the board is still asking for.
 */
function blockKeys(permanent: BoardPermanent): readonly string[] | undefined {
  return permanent.stagedBlockKeys ?? permanent.blockingKeys;
}

/** A permanent the seam draws rather than the row: declared, or proposed. */
function inCombat(permanent: BoardPermanent): boolean {
  return permanent.attacking === true || permanent.staged === true || blockKeys(permanent) !== undefined;
}

/**
 * A proposal rather than a declaration: staged to attack, or staged to block.
 *
 * One predicate for both, because the band draws them the same way and for the
 * same reason — the difference between "I am thinking about it" and "I have said
 * it" is one difference, whichever side of the seam is thinking. A permanent the
 * kernel already has attacking is never a proposal, whatever else is set on it.
 */
function isProposal(permanent: BoardPermanent): boolean {
  return (
    permanent.attacking !== true && (permanent.staged === true || permanent.stagedBlockKeys !== undefined)
  );
}

/**
 * One seat, split into what its row still draws and what the seam took.
 *
 * The split is on *groups* rather than on permanents, so a creature carrying an
 * Equipment takes the Equipment with it and the tray stays whole. Lands are
 * never in it — a land cannot attack, and the mana base is a band of its own —
 * so they are left out of the grouping entirely and put back afterwards.
 */
function splitSeat(side: BoardSide): {
  readonly held: BoardSide;
  readonly groups: readonly PermanentGroup[];
} {
  const field = side.battlefield;
  const lands = field.permanents.filter((permanent) => isLand(permanent.card));
  const others = field.permanents.filter((permanent) => !isLand(permanent.card));
  const groups = groupAttachments(others);
  const lifted = groups.filter((group) => inCombat(group.host));
  if (lifted.length === 0) return { held: side, groups: [] };
  const gone = new Set(lifted.flatMap((group) => [group.host.key, ...group.held.map((one) => one.key)]));
  const battlefield: BattlefieldProps = {
    ...field,
    permanents: [...others.filter((permanent) => !gone.has(permanent.key)), ...lands],
    // The seat still controls them, so the head still counts them.
    count: field.permanents.length,
  };
  return { held: { ...side, battlefield }, groups: lifted };
}

/**
 * One attacker in the band, wrapped so the band can say which seat it came from
 * and whether it has been declared.
 *
 * The wrapper carries the two attributes and nothing else; the card inside is
 * the identical node the row would have drawn, handlers and marks and all, which
 * is what makes a click on an attacker in the band mean the same thing as a
 * click on it in the row.
 */
function entryNode(props: BattlefieldProps, entry: CombatEntry, cover?: ReactNode): ReactElement {
  const host = entry.group.host;
  const blocks = blockKeys(host);
  return createElement(
    'div',
    {
      key: host.key,
      className: 'mtg-combat__entry',
      'data-seat': entry.seat,
      'data-state': isProposal(host) ? 'staged' : 'declared',
      // What this entry is answering, when it is answering one. Written for the
      // same reason `data-seat` is: the relation is drawn as a position, and a
      // position is the one thing a test cannot read back off the picture.
      ...(blocks === undefined ? {} : { 'data-blocks': blocks.join(',') }),
    },
    groupNode(props, entry.group, cover),
  );
}

/** One item in the strip: a card, and the blockers staged or declared against it. */
interface CombatPair {
  readonly attacker: CombatEntry;
  readonly blockers: readonly CombatEntry[];
}

/**
 * The strip's order and its grouping in one pass: every attacker, carrying each
 * not-yet-placed blocker staged against it.
 *
 * Attackers keep the order the two rows gave them, which is the order the board
 * is in, so nothing moves under the player as they assign. A staged blocker
 * whose attacker is not in the strip becomes a pair of its own at the end rather
 * than being dropped — that is a staged *attacker* of the viewer's own, which is
 * what this list holds one turn step earlier and the only other thing in it.
 *
 * Grouping here rather than in the layout is `mtg-7all`: the drawing has to be
 * one bounded element per pair, and the order alone cannot produce one.
 */
function pairEntries(entries: readonly CombatEntry[]): readonly CombatPair[] {
  const answered = new Set<string>();
  const pairs: CombatPair[] = [];
  for (const entry of entries) {
    if (blockKeys(entry.group.host) !== undefined) continue;
    const blockers: CombatEntry[] = [];
    for (const other of entries) {
      if (answered.has(other.group.host.key)) continue;
      if (blockKeys(other.group.host)?.includes(entry.group.host.key) !== true) continue;
      blockers.push(other);
      answered.add(other.group.host.key);
    }
    pairs.push({ attacker: entry, blockers });
  }
  for (const entry of entries) {
    if (blockKeys(entry.group.host) === undefined) continue;
    if (answered.has(entry.group.host.key)) continue;
    pairs.push({ attacker: entry, blockers: [] });
  }
  return pairs;
}

/**
 * An attacker and the blockers staged against it, in one keylined tray.
 *
 * The tray is `../styles/board/attach.ts`'s, and deliberately: an Equipment and
 * its creature are already drawn as a bordered box with a short connector
 * between them, and a table that says "these two are one thing" two different
 * ways is a table a player has to learn twice.
 *
 * It is a named `group`, for the reason `./Battlefield.ts`'s `attachedGroup` is:
 * the relation is drawn, and a drawn relation reaches nobody using a screen
 * reader. The blocker still carries its own sentence (`stagedBlockMark`), so the
 * name here is the pairing read from the attacker's side and not a second copy
 * of it.
 */
function pairNode(
  props: {
    readonly you: BattlefieldProps;
    readonly opponent: BattlefieldProps;
  },
  pair: CombatPair,
): ReactElement {
  const host = pair.attacker.group.host;
  const field = (entry: CombatEntry): BattlefieldProps => (entry.seat === 'you' ? props.you : props.opponent);
  const names = pair.blockers.map((entry) => entry.group.host.card.name);
  return createElement(
    'div',
    {
      key: `pair-${host.key}`,
      className: 'mtg-combat__pair',
      // Which attacker this tray is about, written rather than left to the
      // layout, for the same reason `entryNode` writes `data-blocks`: a position
      // is the one thing a test cannot read back off the picture.
      'data-attacker': host.key,
      role: 'group',
      'aria-label': `${host.card.name}, blocked by ${names.join(', ')}`,
    },
    entryNode(field(pair.attacker), pair.attacker),
    createElement('span', { key: 'link', className: 'mtg-combat__pair-link', 'aria-hidden': true }),
    ...pair.blockers.map((entry) => entryNode(field(entry), entry)),
  );
}

/**
 * Unanswered combatants retain the battlefield's pile contract in the seam.
 * A blocker pair is deliberately a boundary: two creatures assigned to two
 * different attackers are different actionable objects even when their card
 * and visible state happen to match.
 */
function combatPairNodes(
  props: {
    readonly you: BattlefieldProps;
    readonly opponent: BattlefieldProps;
  },
  pairs: readonly CombatPair[],
): readonly ReactElement[] {
  const nodes: ReactElement[] = [];
  let loose: CombatEntry[] = [];

  const flush = (): void => {
    if (loose.length === 0) return;
    const seat = loose[0]?.seat;
    if (seat === undefined) return;
    const battlefield = seat === 'you' ? props.you : props.opponent;
    const piles = groupPermanentPiles(
      loose.map((entry) => entry.group),
      battlefield,
    );
    for (const pile of piles) {
      nodes.push(
        permanentPileNode(battlefield, pile, (field, group, cover) =>
          entryNode(field, { seat, group }, cover),
        ),
      );
    }
    loose = [];
  };

  for (const pair of pairs) {
    if (pair.blockers.length === 0 && (loose.length === 0 || loose[0]?.seat === pair.attacker.seat)) {
      loose.push(pair.attacker);
      continue;
    }
    flush();
    if (pair.blockers.length === 0) loose.push(pair.attacker);
    else nodes.push(pairNode(props, pair));
  }
  flush();
  return nodes;
}

/**
 * Whose halves of the table the band is currently holding cards from.
 *
 * The seat edge (`../styles/board/band.ts`) exists because this band is shared:
 * a card in it has left the half that said whose it was, so the edge says it
 * again in that half's own paper. That argument only holds while the row can
 * hold both. Attacking is one seat's declaration, so through the whole of
 * declare-attackers every entry here is the same seat and the edge is answering
 * a question nobody can be asking. Assembling blocks is the case it was drawn
 * for: `orderEntries` interleaves each attacker with the blockers staged against
 * it, and those came from the other side of the seam.
 *
 * So the edge is drawn off this, and the count is written rather than left to
 * `:has()` twice over. The band's own height already selects on `:has()` and
 * says why (`../styles/board/band.ts`), and the rule there is the one this
 * follows: the sheet may read what is plainly in the DOM. Two seats in a row is
 * not that. It is a fact about the *set* of children, the selector that spells
 * it has to be repeated onto all eight of the edge's spellings, and it is the
 * one thing a test cannot read back off the picture once the edge is gone -
 * which is the same reason `entryNode` writes `data-blocks` instead of leaving
 * the pairing to the layout.
 */
function seatsHeld(entries: readonly CombatEntry[]): 'none' | 'one' | 'both' {
  const seats = new Set(entries.map((entry) => entry.seat));
  if (seats.size >= 2) return 'both';
  return seats.size === 1 ? 'one' : 'none';
}

/**
 * The whole table's combat: both seats reduced, and the seam that holds what
 * came out of them.
 *
 * The band is *open* whenever it holds something *or* the caller passed
 * controls, because the declaration controls are what makes an empty band worth
 * opening — a player being asked for attackers needs to see where attackers go
 * before they have chosen any. With neither, the element is exactly the bar it
 * has always been and `../styles/board/band.ts` gives it back its 8px.
 *
 * The stack strip does not open it. It is drawn on the same element and it is
 * out of flow while the band is a bar (`../styles/board/stack.ts`), so a spell
 * being cast reflows nothing — which is the whole of `mtg-rgc.7`'s second lever
 * and the reason `data-combat` still answers only the combat question.
 */
export function combatTable(props: {
  readonly opponent: BoardSide;
  readonly you: BoardSide;
  readonly combat?: ReactNode;
  /**
   * The stack, drawn on the same seam (`mtg-rgc.7`).
   *
   * It is a child of this element rather than of the lanes, and that is what
   * makes the two arrangements one rule instead of two. While the band is a bar,
   * the strip is positioned against it and draws over the mat; the moment the
   * band opens and holds cards, the strip is an ordinary item in the row beside
   * them and flex layout is what keeps them off each other. Neither state needs
   * the other to know it happened, because both are selected off the
   * `data-combat` this function already writes.
   *
   * A caller that passes nothing — a replay frame, a read-only render — gets the
   * seam it always had.
   */
  readonly stack?: ReactNode;
  /**
   * A pause the board is answering, drawn on the same seam (`mtg-gt4q`).
   *
   * Here for the reason `stack` is here, arriving at the same conclusion down a
   * different road: the seam is the one band of the lanes that is not a row of
   * cards, so it is where a control may sit while the cards on either side of it
   * are moving. Being a child of this element is what lets one sheet keep it off
   * the two things that share the band — the stack strip, which is centered on
   * the same window, and the attackers, which fill this element the moment
   * combat opens. `../styles/board/beat.ts` holds both rules.
   *
   * Out of flow in both states, which is the difference from `stack`. A beat
   * arrives on the same commit as the movement it is about, and an item entering
   * the row would move every card in the band on that commit — which
   * `../motion/runner.ts` would then animate, because a card that moved is the
   * only thing that layer measures.
   *
   * A caller that passes nothing — a replay frame, a read-only render — gets the
   * seam it always had.
   */
  readonly beat?: ReactNode;
}): CombatTable {
  const far = splitSeat(props.opponent);
  const near = splitSeat(props.you);
  const entries: readonly CombatEntry[] = [
    ...far.groups.map((group): CombatEntry => ({ seat: 'opponent', group })),
    ...near.groups.map((group): CombatEntry => ({ seat: 'you', group })),
  ];
  const pairs = pairEntries(entries);
  const controls = props.combat ?? null;
  const open = entries.length > 0 || controls !== null;
  // The attackers scroll and the controls do not, which is why they are two
  // boxes rather than one row. Measured at 1024x768 with three attackers, with
  // both in one scroller: the confirm was drawn past the band's right edge and
  // went out with the scroll, so the one control that ends the declaration was
  // the first thing a crowded attack pushed off the table.
  const strip = createElement(
    'div',
    { key: 'strip', className: 'mtg-combat__strip', 'data-seats': seatsHeld(entries) },
    // A tray only where there is a pair to bound. An unanswered attacker is the
    // bare entry it has always been, so nothing about declare-attackers moved.
    ...combatPairNodes({ you: props.you.battlefield, opponent: props.opponent.battlefield }, pairs),
  );
  const stack = props.stack ?? null;
  const beat = props.beat ?? null;
  const children: ReactNode[] = [
    // Before either, because it is the only thing on this seam that is a
    // question. What is about to resolve and what is fighting are both state,
    // and a reader who has met the pause can decide whether to read them at all.
    ...(beat === null ? [] : [beat]),
    // Then what is about to resolve, before what is fighting: the two are on one
    // seam and only one of them is a decision the player is being asked for
    // right now.
    ...(stack === null ? [] : [stack]),
    ...(open
      ? [
          strip,
          ...(controls === null
            ? []
            : [createElement('div', { key: 'controls', className: 'mtg-combat__controls' }, controls)]),
        ]
      : []),
  ];
  const band = createElement(
    'div',
    {
      className: 'mtg-board__divider',
      ...(open
        ? { 'data-combat': 'true', role: 'group', 'aria-label': COMBAT_ZONE_LABEL }
        : { 'data-combat': 'false' }),
    },
    ...children,
  );
  return { opponent: far.held, you: near.held, band };
}
