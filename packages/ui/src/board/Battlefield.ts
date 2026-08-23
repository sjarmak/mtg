/**
 * The battlefield: compact card faces plus the state that only exists in play.
 *
 * Marks are derived from flags rather than accepted as free text, so a replay
 * frame and a live board can never disagree about what "sick" or "-2" means.
 * Two of them exist because a face can print a value that is not the card's:
 * `derived` carries the size a layer moved it to, `granted` the keywords a
 * layer added, and both name what did it. Nothing else on a board face
 * distinguishes a 3/3 that was printed 1/3 from one that was printed 3/3.
 *
 * One mark is not about the permanent at all. A reticle says something on the
 * stack is aimed *at* this card, and it is half of a mark whose other half
 * `./StackZone.ts` draws on the entry doing the aiming; the number both halves
 * carry is the entry's place in the resolution order, which is what pairs them.
 * `targetedMarks` argues the choice, and `mtg-njrp` is why a relationship
 * between two zones is drawn as a badge in each rather than as a line between
 * them.
 *
 * Attachment is laid out rather than labeled. An Equipment and the creature it
 * is on are grouped into one keylined tray with the weapon drawn small and
 * bottom-aligned beside it (`attachedGroup`), so the relation is read off the
 * table rather than off a three-letter badge; the badge is gone.
 *
 * Two things are laid out rather than listed. A permanent sits in a slot with a
 * fixed footprint, so tapping rotates it inside its own box instead of reflowing
 * the row. The mana base is a row of art tiles under the cards in play, and the
 * zone's body is a column of those two things.
 *
 * **A row no longer draws its empty places, and the badges are down to what a
 * picture cannot say.** Both are the same instruction. the playtester, 2026-08-14:
 * "not sure why there are dashed line card boxes on the battlefield, no reason
 * for them"; "when a card is attacking instead of 'ATK' label they should be
 * moved to that middle combat zone area"; "the modified power toughness from
 * static effects does not need to be repeated on a label in black and white on a
 * card, the underlining of the power and toughness on the card itself is
 * sufficient". Where a card is and how it is drawn says three of the things a
 * three-letter badge used to say, so the badges go and the drawing carries it.
 *
 * What that costs is the same on all three, and it is paid the same way: **a
 * position is not readable by a screen reader and neither is an underline.** So
 * every one of them keeps its sentence, on the card, as a mark that is said
 * rather than shown (`BoardMark.silent`). A sighted player reads the table; a
 * screen reader reads more words than it did before, not fewer.
 *
 * **Combat is drawn at the table rather than in a row**, which is why the
 * attacker is not here: CR 508 attacks a defending *player*, so the object being
 * drawn belongs to neither seat's half. `../board/CombatZone.ts` lifts attackers
 * out of both rows into the seam between them and `./Board.ts` composes the two.
 * This file exports the grouping and the one-group render it needs, so an
 * attacker in the band is the same node it was in the row.
 *
 * **The chip is gone, and so is the band of faces that replaced it; both
 * sentences are left here corrected rather than deleted.** The first read:
 * "Lands leave the card grid entirely and become chips: a mana base is five to
 * nine permanents that each say one thing, and drawn as faces they take half the
 * table away from the permanents whose text matters." the playtester, 2026-08-13,
 * after playing the lab: "I would like to see the lands in play as their card
 * art by the way not just pips." The second said a land was therefore the same
 * board face every other permanent gets, three lines of them in a band beside
 * the row. Then, having played that: "btw I want the lands to show up a little
 * nicer so they are in a row below the cards in play and that they just show
 * their art no thick border and no text."
 *
 * The premise survives both reversals and is what the tile keeps: a mana base is
 * permanents that say one thing each, so it may not compete with the spells for
 * width. It no longer does, because it is not in the row — it is under it, one
 * line tall at a stated height (`../styles/board/lands.ts`, `LAND_TILE_HEIGHT_REM`,
 * with the measurement). Dropping four of the face's five regions is what makes
 * that trade cheap: the tile shows a bigger picture at 48px than the band's
 * board face managed at 90.
 *
 * Three things the chip could not do are still true of the tile: the land's art,
 * its color identity as an edge round the card rather than a swatch beside its
 * name, and tapping as the same rotation the rest of the table uses instead of a
 * change of fill. What the tile drops is words, and only from the screen — the
 * name and the type line stay in the face's `aria-label` and its `title`
 * (`../card/Card.ts`), the rules text stays in the `title`, and the hover zoom
 * beside it is the whole card. A land whose art is missing draws its name, which
 * is the one state where a picture identifies nothing.
 *
 * The spells are the `board` size, which always draws its art (`./CardSlot.ts`).
 * That row is where "I always want to be able to see the art on the
 * battlefield" lands; the art-less compact face stayed behind in the sealed
 * builder, where a hundred cards down a page is the point.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { isAuraCard, isCreature, isLand } from '@mtg/dsl';
import type { CardArt } from '../card/ArtSlot';
import type { FaceStats } from '../card/Card';
import { CardSlot } from './CardSlot';
import type { SlotFace } from './CardSlot';
import { markNode } from './Mark';
import type { BoardMark } from './Mark';
import { Zone } from './Zone';

// The badge itself is `./Mark.ts` now, because `./StackZone.ts` draws the other
// end of the target mark and one shape drawn by two files is one shape the two
// can disagree about. Re-exported here because this is where every caller
// already imports it from, `../index.ts` included.
export type { BoardMark, MarkGlyph, MarkTone } from './Mark';

/**
 * What the summoning-sick mark is called, since its badge is a picture.
 *
 * The playtester, 2026-08-13, after playing the lab: "instead of the text SICK when
 * a creature is summoning sick can we add a little hourglass icon on it to
 * indicate it has to wait to attack?" The hourglass is the badge; this is the
 * name, because an icon alone is not one and a corner glyph with nothing behind
 * it is a mark only the sighted half of the table can read.
 *
 * It states the restriction rather than the rule (CR 302.6), because that is
 * what the projection feeding it reports: `../routes/play/position.ts` asks
 * whether the permanent is actually held back, so a hasted creature never wears
 * this. "Yet" rather than a turn, because the wait ends when its controller's
 * next turn begins and not at the end of this one.
 */
export const SICK_MARK_LABEL = 'Summoning sick: it cannot attack or use tap abilities yet';

/**
 * One object on the stack that is aimed at this permanent.
 *
 * `order` is that object's place in the resolution order counting from the top,
 * which is the same number `./StackZone.ts` prints on its own entry — 1 resolves
 * next. The number is the *pairing*: it is what makes a reticle on a card and a
 * reticle on a stack entry the same mark rather than two coincidences, and it is
 * why the projection may not invent a numbering of its own
 * (`../routes/play/position.ts` derives it from the stack's own array).
 *
 * `source` is what the aiming object is called, already said as its
 * controller's — `Bot's Tide Blade`, `an ability of your Tide Blade`. It is
 * built where the seat names are (CR 113.7a: an ability on the stack has no
 * card, so what can be named is the permanent it was printed on), because this
 * file has no seat labels and no state.
 */
export interface TargetedBy {
  readonly order: number;
  readonly source: string;
}

export interface BoardPermanent {
  readonly key: string;
  readonly card: DslCard;
  readonly tapped?: boolean;
  readonly summoningSick?: boolean;
  /** Damage marked this turn; rendered as a negative mark when above zero. */
  readonly damage?: number;
  readonly counters?: number;
  /** Current planeswalker loyalty; absent for every other permanent. */
  readonly loyalty?: number;
  readonly attacking?: boolean;
  readonly blocking?: boolean;
  /**
   * Whom this permanent is attacking, as that seat is said (CR 508.1a: an
   * attacker is declared against a defending player). The sentence a screen
   * reader gets in place of the badge that used to say `ATK`, and the reason it
   * is a name rather than a flag: the band the card moves into is one strip
   * shared by both seats, so "attacking" without a defender is the half of the
   * fact a sighted player reads off which edge the card entered from.
   *
   * Absent leaves the sentence at "Attacking.", which is what a recorded replay
   * frame can honestly say — the log stores the flag and not the defender.
   */
  readonly attackingDefender?: string;
  /**
   * What is blocking this attacker, by name, in damage-assignment order (CR
   * 509.2). Empty and absent mean the same thing to a reader and are kept apart
   * for nobody: an attacker with no entry is simply not said to be blocked.
   */
  readonly blockedBy?: readonly string[];
  /** And the mirror: what this blocker was assigned to, by name. */
  readonly blockingAttacker?: string;
  /**
   * Chosen to attack but not declared yet — the player's proposal, drawn as one.
   *
   * `mtg-bz2.5`'s confirm boundary seen from the board's end. Nothing about it
   * has reached the kernel: `GameState` has no such field, `choices` gains no
   * entry, and a game replayed from its seed cannot tell a player who staged
   * four creatures and unstaged one from a player who staged three. The flag
   * arrives from the view's own staging state and goes no further than a class.
   */
  readonly staged?: boolean;
  /**
   * The attacker this creature is *staged* to block, by name (CR 509.1a).
   *
   * The blocking half of `staged` above, and it needs a value where the attack's
   * flag needs only a boolean: an attack is a set and a block is a pairing, so
   * "chosen" is the whole fact about a staged attacker and half the fact about a
   * staged blocker. Like `staged`, nothing about it has reached the kernel —
   * `GameState` has no such field, `choices` gains no entry, and a replay cannot
   * tell a player who assigned three blockers and took one back from one who
   * assigned two.
   *
   * The name is what the sentence is built from; `./CombatZone.ts` pairs the two
   * cards on the table off `stagedBlockKey` below.
   */
  readonly stagedBlock?: string;
  /**
   * The same attacker by key, which is what the seam lays the pair out on — the
   * `attachedTo` / `attachedToKey` split one relation over, and for the same
   * reason: a name identifies a card to a reader and cannot find one in a row.
   */
  readonly stagedBlockKey?: string;
  /**
   * Where this blocker sits in the damage assignment order the attacking player
   * is building, 1 first (CR 509.2).
   *
   * The third field on this interface that is a proposal rather than a fact, and
   * it answers to `staged`'s rule exactly: `GameState` has no such field, nothing
   * about it has reached the kernel, and a replay cannot tell a player who
   * ordered three blockers and took one back from one who ordered two. Absent
   * means the blocker has not been placed yet, which is where every ordering
   * starts.
   */
  readonly damageOrder?: number;
  readonly art?: CardArt | null;
  /**
   * The permanent's current size, from whatever measured it — `powerOf` and
   * `toughnessOf` on a live table, a recorded snapshot's derived pair in the
   * replay viewer. Absent prints the card's own numbers, which is right for
   * anything that is not a creature and wrong for every equipped one.
   */
  readonly stats?: FaceStats;
  /**
   * What this permanent is attached to, by name (CR 701.3a). An Equipment says
   * so on its own foot, where a board face has nothing else to print.
   */
  readonly attachedTo?: string;
  /**
   * And the same host by key, which is what the row lays the pair out on.
   * Absent, or naming a permanent this row does not hold, draws the permanent
   * as an ordinary one — an Equipment stays attached across a control change
   * (CR 704.5m does not test control), so the host really can be in the other
   * seat's row.
   */
  readonly attachedToKey?: string;
  /**
   * Who controls this attachment when it is displayed in another seat's row.
   *
   * Attachments travel visually with their host, even when the two permanents
   * have different controllers. Absent means the row already communicates the
   * controller. Present keeps that rules fact in both the visible foot line and
   * the attachment group's accessible name.
   */
  readonly controlledBy?: string;
  /**
   * What is attached to this permanent, by name. Read as the source of a
   * derived value: it is what the `derived` and `granted` marks name when they
   * say where a number that is not the printed one came from.
   */
  readonly attachments?: readonly string[];
  /**
   * The keywords this permanent has now that its card does not print, in
   * printed English. A board face draws no rules box, so without this a
   * creature a weapon granted flying to reads exactly like one that has none.
   */
  readonly gainedKeywords?: readonly string[];
  /**
   * What on the stack is aimed at this permanent, top of the stack first.
   *
   * Empty and absent mean the same thing and are kept apart for nobody: a
   * permanent nothing is aimed at simply wears no reticle. A recorded replay
   * frame passes nothing, so the mark is a live-table fact — the log stores the
   * decisions, and which object was on the stack pointing where is not one of
   * them.
   */
  readonly targetedBy?: readonly TargetedBy[];
  /**
   * Inert when false; the caller owns the legality question, not this view. The
   * hand's flag by the same name and for the same reason: a permanent no offered
   * move acts on is a permanent there is nothing to click. One thing follows and
   * nothing else does. The face is drawn without its button, so it is neither a
   * click target nor a tab stop. It is not drawn faded at rest: the one rule in
   * the shipped sheet that dims an unplayable permanent fires only inside a
   * target choice, where the whole table goes quiet around the cards the spell
   * may be aimed at (`../styles/board/aim.ts`, `mtg-bz2.6`). At every other
   * moment most of a board is unplayable and dimming it would dim the board.
   */
  readonly playable?: boolean;
}

export interface BattlefieldProps {
  readonly label: string;
  readonly permanents: readonly BoardPermanent[];
  /**
   * What the zone's head counts, when the row is not drawing every permanent it
   * was given. Absent counts what is in the row, which is right everywhere else.
   *
   * The one caller is `./CombatZone.ts`, which takes the attackers out of both
   * rows: a seat with four permanents and two of them attacking still controls
   * four, and a head that said two would be reporting the drawing rather than
   * the game.
   */
  readonly count?: number;
  readonly selectedKey?: string;
  readonly onSelect?: (permanent: BoardPermanent) => void;
  /**
   * The double click and the context gesture, on the same permanents `onSelect`
   * reaches. Three gestures, one legality rule: a permanent the caller drew as
   * having nothing on offer answers to none of them.
   */
  readonly onActivate?: (permanent: BoardPermanent) => void;
  readonly onMenu?: (permanent: BoardPermanent) => void;
  /** The move picker belonging to a permanent; see `Hand`'s prop of this name. */
  readonly pickerFor?: (key: string, name: string) => ReactNode;
  readonly emptyText?: string;
}

function sizeText(stats: FaceStats): string {
  return `${String(stats.power)}/${String(stats.toughness)}`;
}

/**
 * Everything on this permanent that a derived value could have come from, named
 * the way a player would name it.
 *
 * Only what the board actually knows, which is two things: what is attached to
 * it, and how many counters are on it. The kernel does not record which effect
 * moved which characteristic, so a creature pumped by a spell is a creature
 * whose current pair differs and whose source list is empty, and the sentence
 * then says the difference and stops. Naming a source we cannot name would be
 * worse than naming none.
 */
function derivedSources(permanent: BoardPermanent): readonly string[] {
  const sources = [...(permanent.attachments ?? [])];
  const counters = permanent.counters ?? 0;
  if (counters > 0) sources.push(`${String(counters)} +1/+1 counter${counters === 1 ? '' : 's'}`);
  if (counters < 0) sources.push(`${String(-counters)} -1/-1 counter${counters === -1 ? '' : 's'}`);
  return sources;
}

function fromClause(sources: readonly string[]): string {
  return sources.length === 0 ? '' : `, from ${sources.join(', ')}`;
}

/**
 * The size a creature actually is, when that is not the size on its card.
 *
 * **The badge used to hold the printed pair with a line through it**, on the
 * argument that the corner and the foot together read "was 1/3, is 3/3" without
 * either of them having to say both, and that drawing the current pair here
 * would put the same number on the card twice. `mtg-3rm` is what that cost when
 * it was read rather than argued: a Lookout Landing Sentry that was 3/3 drew a
 * badge saying "1/1", struck through, at 11px in the highest-contrast element on
 * the card — and at 11px the line merges into the glyphs, so the badge read as
 * "4/4". The loudest number on the creature was the wrong one, and it was not
 * legible as the wrong one either.
 *
 * So the badge holds the live pair. The duplication the old argument avoided is
 * real and is the smaller cost: the foot prints the same number in type-line
 * type, and a player who is counting a combat is reading the corner. What says
 * the value is derived is no longer the number itself — it is that the badge
 * exists at all (nothing wearing its printed size has one), the dotted underline
 * under the foot's pair (`../styles/board/attach.ts`), and the sentence, which
 * still names the printed pair and what moved it.
 *
 * `stats` is the caller's measurement — `powerOf` and `toughnessOf` on a live
 * table — and the card is the print, so this compares the two facts that were
 * already on hand rather than asking the kernel a third time.
 */
function derivedMark(permanent: BoardPermanent): BoardMark | null {
  const stats = permanent.stats;
  const card = permanent.card;
  if (stats === undefined || !isCreature(card)) return null;
  const printed: FaceStats = { power: card.power, toughness: card.toughness };
  if (stats.power === printed.power && stats.toughness === printed.toughness) return null;
  return {
    key: 'derived',
    label: sizeText(stats),
    tone: 'neutral',
    silent: true,
    title: `Now ${sizeText(stats)}, printed ${sizeText(printed)}${fromClause(derivedSources(permanent))}.`,
  };
}

/**
 * That this permanent is in combat, and against whom — said rather than drawn,
 * because the drawing is that the card is somewhere else.
 *
 * The badge said `ATK` and the card stayed where it was. the playtester, 2026-08-14:
 * "when a card is attacking instead of 'ATK' label they should be moved to that
 * middle combat zone area". So the position is the signal now
 * (`./CombatZone.ts`) and this is the half of it a screen reader can reach: a
 * region boundary is announced, but *which* region a card is in is not something
 * a reader can ask about, and the band holds both seats' attackers.
 *
 * It names what is blocking the attacker when the projection knows, which is
 * strictly more than the badge ever said. That answers the question a player
 * asks during combat — whether this creature's damage is getting through — and
 * it is the one thing the drawing genuinely cannot show yet, since blockers stay
 * in their own row until `mtg-bz2.5` pairs them.
 */
function attackingMark(permanent: BoardPermanent): BoardMark | null {
  if (permanent.attacking !== true) return null;
  const defender = permanent.attackingDefender;
  const blockers = permanent.blockedBy ?? [];
  const attacking = defender === undefined ? 'Attacking' : `Attacking ${defender}`;
  const blocked = blockers.length === 0 ? 'unblocked' : `blocked by ${blockers.join(', ')}`;
  return {
    key: 'attacking',
    label: 'ATK',
    tone: 'negative',
    silent: true,
    title: `${attacking}, ${blocked}.`,
  };
}

/**
 * An attack the player has assembled and not yet declared, said rather than drawn.
 *
 * The mirror of `stagedBlockMark` below, one step earlier: `../routes/play/
 * table.ts` sets `staged: true` on a creature the player has put in the combat
 * band, and the drawing is that the card moved into the seam
 * (`./CombatZone.ts`). A position does not reach a screen reader any more here
 * than it does for a staged block, so this mark says the same thing in words: a
 * proposal, not a declaration.
 *
 * Silent for `attackingMark`'s reason: the drawing already exists, and a badge
 * repeating it would be a second statement of one fact. `table.ts` clears
 * `staged` once the attack is declared and sets `attacking` in its place, so
 * the two flags describe different phases of the same creature and this mark
 * is the one that speaks during the earlier one.
 */
function stagedAttackMark(permanent: BoardPermanent): BoardMark | null {
  if (permanent.staged !== true) return null;
  return {
    key: 'staged-attack',
    label: 'ATK',
    tone: 'pending',
    silent: true,
    title: 'Staged to attack; not declared yet.',
  };
}

/**
 * And the mirror, which stays visible: a blocker has not moved anywhere, so
 * nothing about the table says it is in combat except this badge.
 *
 * What it gains is the sentence. `BLK` alone said a creature was blocking and
 * left the only question worth asking — blocking *what* — to be worked out by
 * reading the whole board, which is exactly the gap the attacker's own move into
 * the band closes on the other side of the pairing.
 */
function blockingMark(permanent: BoardPermanent): BoardMark | null {
  if (permanent.blocking !== true) return null;
  const attacker = permanent.blockingAttacker;
  return {
    key: 'blocking',
    label: 'BLK',
    tone: 'neutral',
    title: attacker === undefined ? 'Blocking.' : `Blocking ${attacker}.`,
  };
}

/**
 * A block the player has assembled and not yet declared, said rather than drawn.
 *
 * Silent for `attackingMark`'s reason, one turn step later: the drawing is that
 * the card has moved into the seam and is sitting against the attacker it
 * answers (`./CombatZone.ts`), and neither a position nor an adjacency reaches a
 * screen reader. It says *not declared yet* in as many words, because a proposal
 * that read exactly like a declaration would be the one difference this whole
 * gesture is built to make legible.
 */
function stagedBlockMark(permanent: BoardPermanent): BoardMark | null {
  const attacker = permanent.stagedBlock;
  if (attacker === undefined) return null;
  return {
    key: 'staged-block',
    label: 'BLK',
    tone: 'pending',
    silent: true,
    title: `Assigned to block ${attacker}; not declared yet.`,
  };
}

/**
 * Where a blocker sits in the damage assignment order being built (CR 509.2).
 *
 * Drawn rather than silent, which is the one way it differs from
 * `stagedBlockMark` above and follows from the same test: that mark is silent
 * because the drawing already exists — the card has moved into the seam against
 * the attacker it answers — and here nothing on the board carries the number. A
 * proposal a sighted player cannot see is a proposal they cannot correct.
 *
 * The badge is `#2` rather than `2`, because a bare number in a row of marks
 * beside `+1` and `dmg` reads as a count of something the creature has.
 */
function damageOrderMark(permanent: BoardPermanent): BoardMark | null {
  const place = permanent.damageOrder;
  if (place === undefined) return null;
  return {
    key: 'damage-order',
    label: `#${String(place)}`,
    tone: 'pending',
    title: `Takes damage ${String(place)} in the order being assigned; not confirmed yet.`,
  };
}

/**
 * Damage marked on a creature this turn, in words that cannot be read as a
 * shrinking effect.
 *
 * The badge was the same pill every other mark wears with the text `-3` in it,
 * and `mtg-3rm` reported the obvious consequence: a Magic player reads `-3` as a
 * -3/-3, not as three damage marked. `dmg` costs three characters and removes
 * the whole ambiguity, and the sentence behind it answers the question the
 * badge is actually being asked during combat — what dies — by naming the
 * toughness it is counting against and how much more is lethal.
 *
 * Lethal is measured against the creature's *current* toughness (CR 704.5g),
 * which is `stats` when the caller measured one and the print otherwise, so a
 * creature holding a weapon is not reported as one hit from death on its
 * printed number. Damage at or past that toughness has a sentence of its own
 * rather than a negative count: state-based actions have not run yet, and "0
 * more is lethal" is not something to say to a player.
 */
function damageMark(permanent: BoardPermanent): BoardMark | null {
  const damage = permanent.damage ?? 0;
  if (damage <= 0) return null;
  const card = permanent.card;
  const toughness = permanent.stats?.toughness ?? (isCreature(card) ? card.toughness : null);
  const marked = `${String(damage)} damage marked`;
  const remaining = toughness === null ? null : toughness - damage;
  return {
    key: 'damage',
    label: `${String(damage)} dmg`,
    tone: 'negative',
    title:
      remaining === null
        ? `${marked}.`
        : remaining <= 0
          ? `${marked} against ${String(toughness)} toughness, which is lethal.`
          : `${marked} against ${String(toughness)} toughness; ${String(remaining)} more is lethal.`,
  };
}

/**
 * The keywords the card does not print. Sources are the attachments only: a
 * keyword counter grants keywords too, and `counters` is the net *+1/+1* count,
 * so listing it here would name a source that gave nothing.
 */
function grantedMark(permanent: BoardPermanent): BoardMark | null {
  const gained = permanent.gainedKeywords ?? [];
  if (gained.length === 0) return null;
  return {
    key: 'granted',
    label: gained.map((keyword) => `+${keyword}`).join(' '),
    tone: 'positive',
    title: `Gains ${gained.join(', ')}${fromClause(permanent.attachments ?? [])}.`,
  };
}

/**
 * That something on the stack is aimed at this permanent — one mark per aiming
 * object, each carrying that object's place in the resolution order.
 *
 * `mtg-njrp`. Two copies of one creature, an equip on the stack aimed at one of
 * them, and nothing on the table saying which: killing the targeted one makes the
 * equip fizzle (verified in the kernel — `resolveAttach` skips the effect with
 * `target is no longer legal` and the weapon attaches to nothing) and killing
 * the other one does not, so the choice between two creatures that differ in
 * nothing is not free at all. `../routes/play/naming.ts` is right that no
 * sentence about the *body* separates them; the relationship is between a stack
 * object and a board object, so it has to be drawn.
 *
 * **A reticle rather than an arrow.** A line between the stack box and a card
 * crosses two independently scrolling containers, and this board's slots move
 * under `flex-shrink`, a quarter turn and a combat band that lifts cards out of
 * their row — every one of which would have to redraw the line. The cheap
 * family is one mark on both ends, and it is also the only family a screen
 * reader can read: `./StackZone.ts` puts the same reticle on the entry doing the
 * aiming, and the number pairs them.
 *
 * **Always on, never on hover.** What it reports is a fact about the game state
 * rather than a view mode, the question it answers ("which one is it aimed at")
 * is asked while the player is looking at the *cards* and not at the stack, and
 * a hover-only mark is unreachable from a keyboard and invisible to a finger.
 * The pointer is the one input that could have driven it and the two that could
 * not are the ones this surface promises (`../routes/play/rail.ts`).
 *
 * One mark per aiming object rather than one mark listing them, so a permanent
 * two things are aimed at wears two reticles with two numbers and each carries
 * its own sentence. A single mark would have to build a sentence out of a list,
 * and the list is exactly what the numbers are for.
 */
function targetedMarks(permanent: BoardPermanent): readonly BoardMark[] {
  return (permanent.targetedBy ?? []).map((aim) => ({
    key: `targeted-${String(aim.order)}`,
    label: `Targeted by ${aim.source}`,
    tone: 'neutral' as const,
    glyph: 'reticle' as const,
    badge: String(aim.order),
    title: `Targeted by ${aim.source}, ${String(aim.order)} on the stack.`,
  }));
}

/**
 * The marks a permanent's flags earn, in a fixed order.
 *
 * Two of them say a value on the face is not the card's: `derived` for a size
 * the layer system moved and `granted` for a keyword it added. That is
 * `mtg-fc6`'s second half — a 3/3 that was printed 1/3 used to draw exactly
 * like a printed 3/3, so the one number a player counts combat with was the one
 * number the table would not admit it had changed. `derived` now carries that
 * number itself rather than the one it replaced; `derivedMark` has the reason.
 *
 * There is no `EQUIP` mark any more, and its absence is the first half. A
 * three-letter tag was the only thing relating a weapon to the creature holding
 * it; the row now draws the two as one object (`attachedGroup`) and these two
 * marks name the weapon as the source of what it changed, which is strictly
 * more than the tag said and in the place the eye already is.
 *
 * **Two of the marks below are drawn nowhere and said everywhere** (`silent`),
 * and the order still holds them, because the order is the order a reader hears
 * them in. `derived` in particular has to stay in the list whatever it looks
 * like: the dotted underline that replaced its badge is selected off it.
 */
export function permanentMarks(permanent: BoardPermanent): readonly BoardMark[] {
  // First, because it is the one mark that is about something the player has to
  // answer *now*: everything under it is a standing fact about the permanent,
  // and this is an object waiting to resolve onto it.
  const marks: BoardMark[] = [...targetedMarks(permanent)];
  const stagedAttack = stagedAttackMark(permanent);
  if (stagedAttack !== null) marks.push(stagedAttack);
  const attacking = attackingMark(permanent);
  if (attacking !== null) marks.push(attacking);
  const blocking = blockingMark(permanent);
  if (blocking !== null) marks.push(blocking);
  const stagedBlock = stagedBlockMark(permanent);
  if (stagedBlock !== null) marks.push(stagedBlock);
  // Beside the block it belongs to: both are about this creature's part in the
  // combat being resolved, and the order is only ever asked once the block is.
  const damageOrder = damageOrderMark(permanent);
  if (damageOrder !== null) marks.push(damageOrder);
  if (permanent.summoningSick === true) {
    marks.push({ key: 'sick', label: SICK_MARK_LABEL, tone: 'pending', glyph: 'hourglass' });
  }
  const derived = derivedMark(permanent);
  if (derived !== null) marks.push(derived);
  const granted = grantedMark(permanent);
  if (granted !== null) marks.push(granted);
  // Net, and either sign. `counters > 0` was the old test, so a creature under
  // two -1/-1 counters wore nothing at all while its size fell by two.
  const counters = permanent.counters ?? 0;
  if (counters !== 0) {
    marks.push({
      key: 'counters',
      label: counters > 0 ? `+${String(counters)}` : String(counters),
      tone: counters > 0 ? 'positive' : 'negative',
    });
  }
  if (permanent.loyalty !== undefined) {
    marks.push({
      key: 'loyalty',
      label: `L${String(permanent.loyalty)}`,
      title: `${String(permanent.loyalty)} loyalty counter${permanent.loyalty === 1 ? '' : 's'}.`,
      tone: 'neutral',
    });
  }
  const damage = damageMark(permanent);
  if (damage !== null) marks.push(damage);
  return marks;
}

/**
 * The foot line an attached permanent prints instead of nothing.
 *
 * No face on screen prints a collector line, and on an Equipment — which has no
 * power and toughness either — that leaves the whole foot empty (`../card/
 * Card.ts`, `footRow`), so this is the one row on the face where the attachment
 * fits without displacing anything.
 *
 * It is drawn whether or not the pair could be grouped, and that is deliberate:
 * when they are neighbors in a tray it repeats what the tray shows, and when the
 * host is in the other seat's row it is the only thing on either card that says
 * where the weapon went.
 */
function attachmentFootnote(permanent: BoardPermanent): string | undefined {
  if (permanent.attachedTo === undefined) return undefined;
  const relation = `${isAuraCard(permanent.card) ? 'Enchanting' : 'Equipping'} ${permanent.attachedTo}`;
  return permanent.controlledBy === undefined
    ? relation
    : `${relation} · controlled by ${permanent.controlledBy}`;
}

export function permanentNode(
  props: BattlefieldProps,
  permanent: BoardPermanent,
  face: SlotFace = 'board',
): ReactElement {
  const marks = permanentMarks(permanent);
  const inert = permanent.playable === false;
  const onSelect = inert ? undefined : props.onSelect;
  const onActivate = inert ? undefined : props.onActivate;
  const onMenu = inert ? undefined : props.onMenu;
  const picker = props.pickerFor?.(permanent.key, permanent.card.name) ?? null;
  const footnote = attachmentFootnote(permanent);
  return createElement(CardSlot, {
    key: permanent.key,
    kind: 'play',
    face,
    card: permanent.card,
    art: permanent.art ?? null,
    selected: props.selectedKey === permanent.key,
    tapped: permanent.tapped === true,
    permanentKey: permanent.key,
    ...(permanent.stats === undefined ? {} : { stats: permanent.stats }),
    ...(footnote === undefined ? {} : { footnote }),
    ...(marks.length === 0
      ? {}
      : { marks: createElement('span', { className: 'mtg-slot__marks' }, ...marks.map(markNode)) }),
    ...(picker === null ? {} : { picker }),
    ...(onSelect === undefined
      ? {}
      : {
          onSelect: (): void => {
            onSelect(permanent);
          },
        }),
    ...(onActivate === undefined
      ? {}
      : {
          onActivate: (): void => {
            onActivate(permanent);
          },
        }),
    ...(onMenu === undefined
      ? {}
      : {
          onMenu: (): void => {
            onMenu(permanent);
          },
        }),
  });
}

/** A permanent and whatever this row holds that is attached to it. */
export interface PermanentGroup {
  readonly host: BoardPermanent;
  readonly held: readonly BoardPermanent[];
}

/**
 * The row's permanents, with each attachment moved next to what it is attached
 * to.
 *
 * Battlefield order is the kernel's, which is the order things arrived, so a
 * weapon and the creature it was equipped to five turns later are two cards
 * with a row between them. Grouping is the whole of the spatial fix: nothing
 * can be drawn as attached while the two are not neighbors.
 *
 * A permanent whose host this row does not hold stays a host of its own with an
 * empty `held`. Live and replay projections normally file an attachment with
 * its host, including across controllers, but this component also accepts
 * stated positions and must remain honest when a caller supplies only one end.
 */
export function groupAttachments(permanents: readonly BoardPermanent[]): readonly PermanentGroup[] {
  const held = new Map<string, BoardPermanent[]>();
  for (const permanent of permanents) {
    const key = permanent.attachedToKey;
    if (key === undefined || !permanents.some((candidate) => candidate.key === key)) continue;
    const run = held.get(key);
    if (run === undefined) held.set(key, [permanent]);
    else run.push(permanent);
  }
  const attached = new Set([...held.values()].flat().map((permanent) => permanent.key));
  return permanents
    .filter((permanent) => !attached.has(permanent.key))
    .map((host) => ({ host, held: held.get(host.key) ?? [] }));
}

/**
 * A permanent and its attachments, drawn as one object rather than as two cards
 * that happen to be adjacent.
 *
 * The playtester, 2026-08-13: "we need some way of the equipment attaching visually
 * to the card". Three things do the attaching, and none of them is a word: the
 * pair sits inside one keylined tray, which no other neighbor on the row shares
 * with anything; a short connector bridges them, where every other neighbor has
 * only the row's gap; and the weapon is drawn smaller and sitting on the tray's
 * floor, which is what makes it read as *held by* the creature rather than as
 * standing beside it. The geometry is `../styles/board/lands.ts`; this file decides
 * only what is grouped.
 *
 * A tuck — the weapon drawn behind the creature, overlapping it — was the other
 * candidate and is the stronger picture. It is not what shipped, because the
 * overlap has to be a fraction of the *card's* width and both the negative
 * margin and the percentage offset that could express it resolve against the
 * zone's width instead, which is the one length on this route that changes with
 * the permanent count. A tray needs no such number.
 *
 * The group is a `group` with a name, because the relation is now drawn and a
 * drawn relation is invisible to a screen reader. It names the host first and
 * the weapons after, which is the order a player says it in and the order the
 * two cards are read in.
 */
function attachedGroup(props: BattlefieldProps, group: PermanentGroup): ReactElement {
  const relationName = (permanent: BoardPermanent): string =>
    permanent.controlledBy === undefined
      ? permanent.card.name
      : `${permanent.card.name}, controlled by ${permanent.controlledBy}`;
  const equipment = group.held.filter((permanent) => !isAuraCard(permanent.card)).map(relationName);
  const auras = group.held.filter((permanent) => isAuraCard(permanent.card)).map(relationName);
  const relations = [
    ...(equipment.length === 0 ? [] : [`equipped with ${equipment.join(', ')}`]),
    ...(auras.length === 0 ? [] : [`enchanted by ${auras.join(', ')}`]),
  ];
  return createElement(
    'div',
    {
      key: group.host.key,
      className: 'mtg-attach',
      role: 'group',
      'aria-label': `${group.host.card.name}, ${relations.join(', ')}`,
    },
    permanentNode(props, group.host),
    createElement('span', { key: 'link', className: 'mtg-attach__link', 'aria-hidden': true }),
    createElement(
      'div',
      { key: 'held', className: 'mtg-attach__held' },
      ...group.held.map((permanent) => permanentNode(props, permanent)),
    ),
  );
}

/**
 * One group, drawn: a permanent on its own, or a tray holding its attachments.
 *
 * Exported because the combat band draws the same thing. An attacker that is
 * holding a weapon takes the weapon with it — CR 301.5c keeps the Equipment
 * attached through the whole of combat, and a tray split across the seam would
 * be the tray saying the two are one object while the table says they are two.
 */
export function groupNode(props: BattlefieldProps, group: PermanentGroup): ReactElement {
  return group.held.length === 0 ? permanentNode(props, group.host) : attachedGroup(props, group);
}

export function Battlefield(props: BattlefieldProps): ReactElement {
  const lands = props.permanents.filter((permanent) => isLand(permanent.card));
  const others = props.permanents.filter((permanent) => !isLand(permanent.card));
  const groups = groupAttachments(others);
  // Groups rather than permanents, because the row draws one item per group: a
  // creature holding a weapon takes one place on the table, not two.
  //
  // **A spare place is no longer drawn, and nothing replaced it.** The row used
  // to pad itself out to a stated slot count with small dashed card-shaped
  // markers. the playtester, 2026-08-14: "not sure why there are dashed line card
  // boxes on the battlefield, no reason for them". Measured before deleting
  // them, in chrome-headless-shell 151 at four viewports: they held nothing up.
  // A battlefield slot on the play route is sized by the flex column that owns
  // the lane, and the marker is `align-self: center` at a fixed 2.25rem, so it
  // was never the thing keeping a row open — taking every one of them out of
  // layout moved no box on the mat by a tenth of a pixel.
  //
  // What replaces them is the honest sentence the zone already had: a row with
  // nothing in it renders `emptyText` rather than a wall of holes, so a blank
  // half of the mat still reads as a board rather than as a surface that failed.
  const played: ReactNode[] = groups.map((group) => groupNode(props, group));
  // The same node every other permanent gets, drawn as a tile instead of a
  // face. A land's picker rides inside its slot exactly as a spell's does, which
  // is what retired the Fragment this map used to wrap each chip in: the chip
  // was itself the button, so a picker could not be nested in it, and the
  // wrapper had to be unconditional or opening a picker would remount the chip
  // out from under the focus ring.
  const band =
    lands.length === 0
      ? null
      : createElement(
          'div',
          { key: 'lands', className: 'mtg-lands' },
          ...lands.map((land) => permanentNode(props, land, 'art')),
        );
  // Two items, not n: the cards in play in a row of their own, and the mana base
  // under it. The spells need a box because the body is a column now — without
  // one, every permanent would be a line of the column. The band is the row's
  // *sibling* rather than its last child, so scrolling the spells sideways can
  // never take the mana base off the screen with them.
  //
  // The row is drawn even when it holds nothing, as long as the seat holds
  // *something*: it is the box the phase bar sits under and the box the mana
  // base sits below, and dropping it moved both. A seat with nothing at all
  // still falls through to the zone's own sentence.
  const items: ReactNode[] =
    played.length === 0 && band === null
      ? []
      : [
          createElement('div', { key: 'spells', className: 'mtg-board__spells' }, ...played),
          ...(band === null ? [] : [band]),
        ];
  return createElement(Zone, {
    label: props.label,
    items,
    layout: 'board',
    // The zone counts permanents, not what the row happens to draw: the mana
    // base is permanents in a band of its own, and an attacker is a permanent
    // this seat controls while the seam is drawing it (`count` says why).
    count: props.count ?? props.permanents.length,
    emptyText: props.emptyText ?? 'no permanents',
  });
}
