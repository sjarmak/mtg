/**
 * Beats: the points the settle loop halts at so a person can see the game
 * happen.
 *
 * **This is not a stop, and the difference is the whole module.** A stop
 * (`autopass.ts`) says "offer me my plays at this priority", and `mtg-hmy`
 * qualified it with `canRespond` for a good reason: a prompt whose only button
 * is Pass is not a decision put to the player, it is a page they have to
 * dismiss. That qualification closed the door on the obvious fix for `mtg-0sn` —
 * ticking `combatDamage` in the stop set buys nothing for a player with an empty
 * hand, because the kernel enumerates a pass and a mana ability there and
 * nothing else — and `stopWantsAQuestion`'s own docblock says so and names this
 * bead.
 *
 * So a beat is the other instrument. It asks no question, offers no option, and
 * **records nothing**. `advance` simply stops running and hands the session back
 * with the board standing where combat left it; the caller draws it, the player
 * looks, and the next `advance` picks the loop up exactly where it dropped it.
 * Seed plus `choices` is still the entire record of a played game, so
 * `replaySession` and `stateFingerprint` cannot tell a paced game from a
 * hurried one. That is why the pause lives in `SessionOptions` rather than in
 * `GameState`, for the same reason and by the same argument the stop set does.
 *
 * **What was wrong before.** One click on "Attack with both" ran the attack
 * declaration, the opponent's blocks, the damage step, end of combat, the second
 * main phase, the end step and the whole of the opponent's next turn, and set
 * the player down two turns later with a changed life total and a log to read.
 * Measured on the flagship set in a real browser (`mtg-0sn`, and reproduced in
 * `test/beats.test.ts` without one): turn 5, declare attackers, 46 choices made
 * to turn 5, second main phase, 51 choices made, with the opponent's life going
 * 20 to 17. Three beats put the three things that happened on screen one at a
 * time.
 *
 * **Read off events rather than steps**, because a step is where the game is and
 * an event is what it did. The damage step is entered on every turn of every
 * game, including the ones where nobody attacked; `combatDamageStep` fires there
 * regardless, so a pause keyed on entering the step would stop a player on an
 * empty board every turn — which is exactly the friction `mtg-hmy` had just
 * finished removing. `damageDealt` fires when damage was dealt, and that is the
 * thing worth looking at.
 *
 * **The fourth beat is a death, and it is why this module has two vocabularies
 * rather than one** (`mtg-302`). A creature was cast, the opponent answered it
 * with removal at a priority the player held no instant for, and the cast, the
 * removal, the death and the death trigger's token all landed inside a single
 * press. The kernel was cleared of it — `test/cast-resolution.test.ts` is that
 * acquittal — and what was missing was a frame. Measured on the flagship set
 * over 40 seeded games: 62 settle windows held a death, 48 of them halted on
 * nothing that showed it, at a median of 139 events per window, and 46 of those
 * 48 also held a spell the opponent cast in the same window.
 *
 * **The fifth beat is a departure that is not a death** (`mtg-j7kj`), and it is
 * the same report a third time. the playtester, playing the flagship on 2026-08-18:
 * the bot answered one of her creatures with an exile and "to me it looks like
 * it just instantly disappeared". `beatOf` had already named this case and declined
 * it, on the grounds that the log narrates the effect; a log is a record and the
 * board is what the player is looking at, so the frame was still missing.
 * Measured the same way, on the flagship over 40 seeded games: 6116 settle
 * windows, 8 of them held a permanent leaving the battlefield for somewhere
 * other than a graveyard, all 8 halted on nothing that showed it, none of the 8
 * also held a death, at a median of 8 events per window. About a fifth of a halt
 * per game, against 9 exiles nobody was shown. Held at three times the sample:
 * 120 games, 17967 windows, 35 departures, all 35 unshown and none of them
 * sharing a window with a death.
 *
 * **A sacrifice is still not one of them**, and that is `beatOf`'s original
 * reason rather than an oversight kept: every `permanentSacrificed` this kernel
 * emits is an activation cost (`reduce.ts`'s `onActivateAbility`), paid by the
 * player who pressed the button, in the same reduce as the press. `choose` runs
 * `beatIn` over exactly that reduce, so a sacrifice beat would stop the player
 * to tell them what they had just chosen — `mtg-hmy`'s page-to-dismiss, in the
 * one shape this module exists to avoid. The rule that falls out is structural
 * and needs no reading of who paid: a departure is a permanent that left the
 * battlefield for a zone that is not a graveyard, and every departure *to* a
 * graveyard already has an event that names it.
 *
 * A death is not shaped like a combat moment, and that is the whole of the
 * design here. The three combat beats each *are* a step in the turn structure,
 * so a surface holding a step can say whether the game pauses there; a death
 * happens wherever it happens, and a bar that marked every step because a
 * creature might die in one would be making the same false statement in the
 * other direction. And a combat beat needs no payload — the board it hands back
 * is the answer — while a death has already left the battlefield by the time
 * anybody looks, so the halt has to carry what died. So:
 *
 *  - `BeatKind` is what a player asks to be paused for: five names, a set of
 *    them in `SessionOptions`.
 *  - `Beat` is what the session is paused *on*: a tagged value, because two of
 *    the five carry something.
 *  - `BEAT_STEPS` is the step mapping, total over `BeatKind`, with `null` for
 *    the two that have no step. It is a `Record` so that a sixth beat fails to
 *    compile until somebody states which steps it belongs to — the shape before
 *    `death` had no room for "none", and a new beat would have inherited "no
 *    step" silently. It did its job once already: `departure` could not be added
 *    without answering.
 *
 * Nothing here is a judgment: five event types, one list membership test each,
 * and one total `Record` from a zone to whether arriving in it is a departure.
 * No scoring, no threshold, no guess about what the player meant.
 */
import type { GameEvent } from './events';
import type { ObjectId } from './ids';
import type { Step, ZoneId } from './state';

/**
 * The three moments of a combat worth a beat, named for what the player sees.
 *
 * CR 508 (declare attackers), CR 509 (declare blockers) and CR 510 (combat
 * damage) are the three turn-based actions a combat is made of, and each one is
 * a fact about the board that no other step will restate.
 */
export type CombatBeat = 'attackers' | 'blockers' | 'damage';

/**
 * Everything a player can ask the loop to halt for.
 *
 * `CombatBeat` keeps its name and its meaning because it keeps its property:
 * each of the three is a step, and `BEAT_STEPS` is where that is written down.
 * `'death'` and `'departure'` are the two that are not.
 */
export type BeatKind = CombatBeat | 'death' | 'departure';

export type BeatSet = ReadonlySet<BeatKind>;

/**
 * What the session is paused on.
 *
 * A tagged value rather than a bare name, because a death is invisible on the
 * board it hands back: `permanentDestroyed` fires and the object is in a
 * graveyard by the time the caller draws anything, so the halt names the
 * permanents itself. A surface that had to find them again would be re-deriving
 * a batch boundary the session does not expose, which is a second answer to
 * "what just died".
 *
 * `oids` is every permanent destroyed in the batch, not the first: a board wipe
 * and a trade are one halt each and both are one sentence.
 *
 * A departure carries the zone as well as the id, because "was exiled",
 * "was returned to its owner's hand" and "was put into its owner's library" are
 * three different sentences about three different futures for the card, and a
 * surface handed the id alone would have to look the object up in a zone it has
 * already moved to in order to say which. The board it hands back cannot answer
 * either: the permanent is not on it.
 */
export type Beat =
  | { readonly kind: CombatBeat }
  | { readonly kind: 'death'; readonly oids: readonly ObjectId[] }
  | { readonly kind: 'departure'; readonly departures: readonly Departure[] };

/**
 * The zones a permanent leaving the battlefield can be shown leaving for.
 *
 * Not a graveyard, which is the whole of the rule: a permanent put into a
 * graveyard was destroyed or sacrificed, and both of those are already named by
 * an event of their own (`permanentDestroyed`, `permanentSacrificed`). The
 * module docblock has the argument for why a sacrifice is not a beat.
 */
export type DepartureZone = 'exile' | 'hand' | 'library';

/** One permanent that left the battlefield, and where it went. */
export interface Departure {
  readonly oid: ObjectId;
  readonly to: DepartureZone;
}

/** Every beat, in the order a combat produces them. */
export const COMBAT_BEATS: readonly CombatBeat[] = ['attackers', 'blockers', 'damage'];

/** Every beat there is, combat and otherwise. */
export const ALL_BEATS: readonly BeatKind[] = [...COMBAT_BEATS, 'death', 'departure'];

/**
 * What a player who has configured nothing gets: all of them.
 *
 * A combat that is declared, blocked and paid for in one click is the bug; a
 * combat that shows two of its three moments is the same bug with a smaller
 * hole in it, and a creature that arrives and dies inside one press is that bug
 * again outside combat, as is one that is exiled inside one. The set exists so a caller that does not want the pacing
 * — the sim, the balance sweep, a replay — can say so by leaving the option off
 * entirely, which every one of them already does.
 */
export const DEFAULT_BEATS: BeatSet = new Set<BeatKind>(ALL_BEATS);

/** No pacing at all: the settle loop runs to the next decision, as it always did. */
export const NO_BEATS: BeatSet = new Set<BeatKind>();

/**
 * The steps a beat can arise in, or `null` when it can arise anywhere.
 *
 * Total over `BeatKind` on purpose. `stepShowsBeat` used to switch on `Step`
 * alone, which meant a beat with no step of its own was reported as pausing
 * nowhere without anybody having said so — the shape had no way to tell "this
 * beat belongs to no step" from "nobody thought about this beat". Here the null
 * is a stated answer and a fifth beat cannot be added without giving one.
 */
const BEAT_STEPS: Readonly<Record<BeatKind, readonly Step[] | null>> = {
  attackers: ['declareAttackers'],
  blockers: ['declareBlockers'],
  damage: ['firstStrikeDamage', 'combatDamage'],
  // A permanent can be destroyed in any step by a spell, an ability or a
  // state-based action, so no node on a turn-structure bar can claim it.
  death: null,
  // And it can leave the battlefield in any step for the same reasons.
  departure: null,
};

/**
 * Whether arriving in a zone off the battlefield is a departure worth a frame.
 *
 * Total over `ZoneId` rather than a list of the three, for `BEAT_STEPS`' reason:
 * a zone added to the game must state its answer here instead of inheriting
 * "not a departure" from having been forgotten. The two impossible ones are
 * stated as impossible rather than left out — nothing moves from the battlefield
 * to the battlefield, and a permanent does not go back to the stack.
 */
const DEPARTURE_ZONES: Readonly<Record<ZoneId, DepartureZone | null>> = {
  exile: 'exile',
  hand: 'hand',
  library: 'library',
  graveyard: null,
  battlefield: null,
  stack: null,
};

/**
 * The departure one event is, or null when it is not one.
 *
 * Read off `zoneChanged` and nothing else. A sacrifice has an event of its own
 * and is deliberately not read (module docblock); a destroy has one too and is
 * `beatOf`'s `'death'`; and both of those land in a graveyard, which is the one
 * answer `DEPARTURE_ZONES` gives twice.
 */
function departureOf(event: GameEvent): Departure | null {
  if (event.type !== 'zoneChanged' || event.from !== 'battlefield') return null;
  const to = DEPARTURE_ZONES[event.to];
  return to === null ? null : { oid: event.oid, to };
}

/**
 * The beat one event is, or null when it is not one.
 *
 * Three of the four carry a qualification, and all three are structural rather
 * than a guess. An attack declaration of nothing is a legal move (CR 508.1a
 * leaves the set empty) and there is nothing on the board to look at afterwards.
 * Damage that is not combat damage — a burn spell, an ability — belongs to
 * whatever put it on the stack, and that already had a priority window of its
 * own.
 *
 * A declaration of no blockers is deliberately still a beat. "Nothing blocked"
 * is the answer to the question the player asked by attacking, and a player who
 * only learns it from the life total afterwards has been told the outcome
 * instead of shown the play.
 *
 * A death is `permanentDestroyed` and nothing wider (CR 704.5f/g, CR 701.7),
 * and a permanent that leaves the battlefield some other way is the separate
 * `'departure'`. That separation is the sentence rather than the rules: CR
 * 701.7 destroys, CR 701.19 exiles and CR 701.11 returns, and a surface has to
 * say which. `mtg-302` left the widening open as "a decision with its own frame
 * budget, not a detail"; `mtg-j7kj` spent the budget and the docblock above has
 * the count.
 */
function beatOf(event: GameEvent): BeatKind | null {
  switch (event.type) {
    case 'attackersDeclared':
      return event.attacks.length > 0 ? 'attackers' : null;
    case 'blockersDeclared':
      return 'blockers';
    case 'damageDealt':
      return event.combat ? 'damage' : null;
    case 'permanentDestroyed':
      return 'death';
    case 'zoneChanged':
      return departureOf(event) === null ? null : 'departure';
    default:
      return null;
  }
}

/**
 * The first watched beat in one action's events, or null when it holds none.
 *
 * The first rather than all of them, and one batch holds at most one *combat*
 * beat: every combat step grants priority before the next is entered (CR 509.4,
 * CR 510.3), so the declaration, the blocks and the damage each fall in a
 * `reduce` of their own. `test/beats.test.ts` holds that fact rather than
 * leaving it as a comment, because a batch that ever held two would drop the
 * second silently.
 *
 * A death shares a batch with the damage that caused it, and the combat beat
 * wins that batch because it is earlier in the event order and because it is
 * already the right frame: the state-based actions have run by the time the
 * session is handed back, so the damage beat's board is the board with the dead
 * creatures gone. A player who has switched the combat beats off and left deaths
 * on gets the death beat there instead, which is the same frame under a
 * different name.
 *
 * A death and a departure can share a batch too — a spell that exiles one
 * creature and kills another, a sacrifice outlet feeding a removal spell — and
 * the earlier event wins for the same reason, on the same one board. Measured
 * over 40 seeded flagship games, that collision happened in none of the 8
 * windows a departure landed in.
 */
export function beatIn(events: readonly GameEvent[], beats: BeatSet): Beat | null {
  for (const event of events) {
    const kind = beatOf(event);
    if (kind === null || !beats.has(kind)) continue;
    switch (kind) {
      case 'death':
        return {
          kind,
          oids: events.flatMap((each) => (each.type === 'permanentDestroyed' ? [each.oid] : [])),
        };
      case 'departure':
        return {
          kind,
          departures: events.flatMap((each) => {
            const departure = departureOf(each);
            return departure === null ? [] : [departure];
          }),
        };
      default:
        return { kind };
    }
  }
  return null;
}

/**
 * Whether the game pauses somewhere in this step, for a surface that draws the
 * turn structure.
 *
 * It is a second derivation of one fact and it says so. `beatIn` reads events
 * and this reads steps, because the phase bar has a step and no events: it draws
 * a node per `Step` and marks what each one will do. The bead this module first
 * fixed was filed partly against that bar — DAMAGE drawn with the hollow "no
 * stop" mark while the game was silently resolving the whole combat there — so a
 * bar that could not say the game pauses at damage would still be the interface
 * making a false statement about itself.
 *
 * **A beat with no step reports nothing here, and that is the answer rather
 * than a gap.** A death can land in any step, so a bar that marked all thirteen
 * nodes whenever deaths were watched would promise a pause at twelve places the
 * game will usually run straight through, and a departure is the same shape
 * again. `BEAT_STEPS` is where both `null`s are stated.
 *
 * The two derivations are pinned together rather than left parallel:
 * `test/beats.test.ts` plays a combat and checks that every *combat* beat it
 * halted at arose in a step this function names.
 */
export function stepShowsBeat(step: Step, beats: BeatSet): boolean {
  for (const kind of ALL_BEATS) {
    if (!beats.has(kind)) continue;
    if (BEAT_STEPS[kind]?.includes(step) === true) return true;
  }
  return false;
}
