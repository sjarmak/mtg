/**
 * A combat declaration in progress: which creatures are assigned to what, and
 * the one enumerated declaration that assignment names.
 *
 * # The two decisions whose option count is exponential
 *
 * `declareAttackers` and `declareBlockers` are the only decisions in this game
 * where the kernel enumerates a *declaration space* rather than a list of acts.
 * `legal.ts` builds the first as the subsets of the eligible attackers and the
 * second as the cartesian product of each eligible blocker's choices, so both
 * counts are exponential in the creatures standing on the board:
 *
 *   eligible creatures   1   2   3    4    6     8
 *   attack declarations  2   4   8   16   64   256
 *   block declarations   2   4   8   16   64   256   (against one attacker)
 *
 * Both are correct enumerations. CR 508.1 lets each untapped creature attack or
 * not, independently, and CR 509.1 lets each untapped creature block any one
 * attacker it legally can, or none — so every one of those 256 is a distinct
 * legal declaration and the kernel is right to offer all of them. Measured on
 * this checkout with `actionKey`, 256 of 256 are distinct actions.
 *
 * What is wrong is asking a person to find one of them in a flat list.
 * `mtg-y1t` measured a real game at turn 24 with one attacker and eight untapped
 * creatures: 256 buttons, 63,582px of content in a 449px column, three of them
 * fully on screen. No amount of column height fixes that, because the column
 * would have to grow with 2^n.
 *
 * # So the rail builds one declaration instead of listing every declaration
 *
 * The shape is Magic Online's and the bead's: name a creature, say what it is
 * doing, confirm. n creatures make n+1 controls instead of 2^n, and the count
 * is linear in the board rather than exponential in it.
 *
 * **Nothing here re-derives legality**, which is the same rule `cast.ts` keeps
 * one route over. Every candidate a creature is offered is the kernel's own
 * statement of what that creature may be declared against, and the confirm
 * submits either the index of the enumerated option the assignment names or the
 * declaration itself, checked by `validateAction` before it is offered.
 *
 * **An assignment the rules refuse is refused rather than submitted**, and it is
 * a reachable state rather than a defensive branch: menace (CR 702.110b) makes a
 * lone blocker on a menacing attacker illegal, so a player halfway to a legal
 * two-creature block is standing on a declaration the kernel would not take. The
 * panel says so and offers no confirm until the assignment is legal. Candidates
 * are still offered whole rather than narrowed against what is already assigned,
 * so the half-built state is reachable *and* escapable — narrowing them would
 * make the second blocker of a menace block unofferable, and the block
 * unreachable.
 *
 * # The cap was inherited, and is not any more
 *
 * `enumerate.ts` caps at 512 and a crowded board passes it: six untapped
 * creatures against two attackers is 3^6 = 729 declarations, of which the kernel
 * lists 512. This module used to read its candidates off that list and submit an
 * index into it, so it reached exactly the declarations the flat rail reached
 * and no fewer. `mtg-y1t.2` measured what that costs on a three-attacker,
 * eight-blocker board: the 512-option prefix mentions three of the eight
 * blockers in no option at all and offers 13 of the 24 legal pairings, so the
 * roster left three creatures off the board entirely and the truncation was
 * silent rather than merely reported.
 *
 * So the two halves come from the two things the kernel states in full. A
 * creature's candidates come from `Decision.candidates` for a block and from
 * `eligible` plus `defender` for an attack, both of which are linear in the
 * board and neither of which a cap can reach. The finished declaration is
 * submitted as a `Choice`: the enumeration's index where there is one, so an
 * ordinary board records the integer it always did, and the constructed
 * declaration where there is not (`session.ts` carries what that changed).
 */
import type { Action, Choice, CombatDefender, Decision, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { validateAction } from '@mtg/kernel';
import { rosterName, targetName } from './naming';
import type { SeatNames } from './position';

/** The decisions this module builds. Both are exponential; nothing else is. */
export type DeclarationKind = 'declareAttackers' | 'declareBlockers';

/**
 * What one creature is assigned to, identified by a string rather than by an
 * object.
 *
 * A blocker is assigned to an attacking permanent and an attacker is assigned to
 * a defending player, so the two decisions do not share a value type. They do
 * share the only thing this module does with it — compare it, and use it to find
 * an index — so it is carried as a key. `null` is the creature declining, which
 * every creature may always do: `subsets` includes the empty set and `cartesian`
 * gives every blocker a `null` slot.
 */
export type AssignmentKey = string;

/** One thing a creature may be declared against, as a button reads it. */
export interface DeclarationCandidate {
  readonly key: AssignmentKey;
  readonly label: string;
}

/** One creature that may be declared, and what it may be declared against. */
export interface DeclarationSubject {
  readonly oid: ObjectId;
  /** Named as every other move on this surface names a permanent (`naming.ts`). */
  readonly name: string;
  /** Never empty: a creature with nothing to be declared against is not a subject. */
  readonly candidates: readonly DeclarationCandidate[];
}

/** What a creature is currently declared against; absent means it declines. */
export type Assignment = ReadonlyMap<ObjectId, AssignmentKey>;

export interface DeclarationPlan {
  readonly kind: DeclarationKind;
  /** The seat being asked, which is the declaration's own `player`. */
  readonly player: PlayerId;
  /** The eligible creatures, in the order the kernel listed them. */
  readonly subjects: readonly DeclarationSubject[];
  /** Every enumerated declaration, found by the assignment it is. */
  readonly byAssignment: ReadonlyMap<string, number>;
}

/**
 * The four phrases each decision needs, kept beside the model so the panel and
 * the tests read one copy.
 *
 * Two decisions and not one vocabulary: a blocker is assigned to a creature and
 * an attacker to a player, and "Attacks nothing" would be a sentence about a
 * declaration nobody can make.
 */
export interface DeclarationWords {
  /** The heading over the roster, naming what is being assembled. */
  readonly roster: string;
  /** What a creature's row says when it is not declared. */
  readonly idle: string;
  /** What its row says when it is, given what it is declared against. */
  readonly busy: (against: string) => string;
  /** The follow-up question, for a creature with more than one candidate. */
  readonly ask: (name: string) => string;
  /** The answer to that question that declares nothing. */
  readonly decline: string;
  /**
   * What the confirm draws, given how many creatures are declared.
   *
   * The enumerated option's own label is the confirm's accessible name and would
   * be its visible text too, and that is the one place this panel could grow
   * back the height it saved: a declaration's label is one clause per creature,
   * so eight blockers print eight of them on the button that is always on
   * screen. Measured in a real game at two blockers, the enumerated label alone
   * took the panel from 449px of content to 583px and pushed three of six
   * controls under the fold. So the confirm is a *folded* button
   * (`choice-button.ts`): the sentence stays on `aria-label`, exactly as it does
   * for a folded move in the rail, and the visible text is this.
   */
  readonly confirm: (count: number) => string;
}

const WORDS: Readonly<Record<DeclarationKind, DeclarationWords>> = {
  declareAttackers: {
    roster: 'Creatures that can attack',
    idle: 'not attacking',
    busy: (against: string): string => `attacking ${against}`,
    ask: (name: string): string => `Who does ${name} attack?`,
    decline: 'Does not attack',
    confirm: (count: number): string =>
      count === 0 ? 'Attack with nothing' : `Attack with ${String(count)} ${creatures(count)}`,
  },
  declareBlockers: {
    roster: 'Creatures that can block',
    idle: 'not blocking',
    busy: (against: string): string => `blocks ${against}`,
    ask: (name: string): string => `What does ${name} block?`,
    decline: 'Blocks nothing',
    confirm: (count: number): string =>
      count === 0 ? 'No blocks' : `Block with ${String(count)} ${creatures(count)}`,
  },
};

/** One creature or several, so a confirm never reads `1 creatures`. */
function creatures(count: number): string {
  return count === 1 ? 'creature' : 'creatures';
}

export function declarationWords(kind: DeclarationKind): DeclarationWords {
  return WORDS[kind];
}

/**
 * The canonical spelling of a whole assignment.
 *
 * Sorted, so the order creatures were pressed in cannot make two spellings of
 * one declaration. The pair separator is a character no object id contains, and
 * declined creatures are absent rather than spelled with an empty target — an
 * unassigned creature and one assigned to nothing are the same declaration.
 */
export function assignmentKey(assignment: Assignment): string {
  return [...assignment.entries()]
    .map(([oid, key]) => `${oid}>${key}`)
    .sort()
    .join('|');
}

/** The assignment one enumerated declaration is, or null for any other action. */
function assignmentOf(action: Action): Assignment | null {
  if (action.type === 'declareAttackers') {
    return new Map(action.attackers.map((attack) => [attack.oid, defenderKey(attack.defender)]));
  }
  if (action.type === 'declareBlockers') {
    return new Map(action.blocks.map((block) => [block.blocker, block.attacker]));
  }
  return null;
}

function defenderKey(defender: CombatDefender): AssignmentKey {
  return typeof defender === 'number' ? `player:${String(defender)}` : `planeswalker:${defender.oid}`;
}

function defenderOf(key: AssignmentKey): CombatDefender | null {
  if (key === 'player:0') return 0;
  if (key === 'player:1') return 1;
  if (!key.startsWith('planeswalker:')) return null;
  const oid = key.slice('planeswalker:'.length);
  return oid.length === 0 ? null : { kind: 'planeswalker', oid };
}

/** The declaration an assignment is, as the kernel's own action. */
function actionOf(plan: DeclarationPlan, assignment: Assignment): Action | null {
  const player = plan.player;
  if (plan.kind === 'declareAttackers') {
    const attackers: { readonly oid: ObjectId; readonly defender: CombatDefender }[] = [];
    for (const [oid, key] of assignment) {
      const defender = defenderOf(key);
      if (defender === null) return null;
      attackers.push({ oid, defender });
    }
    return {
      type: 'declareAttackers',
      player,
      attackers,
    };
  }
  return {
    type: 'declareBlockers',
    player,
    blocks: [...assignment].map(([blocker, attacker]) => ({ blocker, attacker })),
  };
}

/**
 * Every creature the kernel says may be declared, and what it says each may be
 * declared against.
 *
 * Read off the decision's own linear statements rather than off `canBlock` and
 * the board, for `cast.ts`'s reason: a second derivation of what may block what
 * is a second opinion the kernel never agreed to. Not off `decision.options`
 * either, and that is the fix `mtg-y1t.2` names — a truncated list of
 * declarations is a truncated list of pairings, and the roster it built left
 * three of eight creatures off a real board. A creature that may be declared
 * against nothing — a ground blocker against a lone flyer — has no entry here
 * and is left out of the roster entirely, which is the true statement about it.
 */
function candidatesFor(decision: Decision): ReadonlyMap<ObjectId, readonly AssignmentKey[]> {
  const found = new Map<ObjectId, readonly AssignmentKey[]>();
  if (decision.kind === 'declareAttackers') {
    const defenders = decision.defenders.map(defenderKey);
    for (const oid of decision.eligible) found.set(oid, defenders);
  } else if (decision.kind === 'declareBlockers') {
    for (const entry of decision.candidates) found.set(entry.blocker, entry.attackers);
  }
  return found;
}

/**
 * The staged declaration for this decision, or `null` when the decision is not
 * one.
 *
 * A decision the kernel enumerated exactly one option for gets no plan either,
 * and that is the same rule `cast.ts` applies to a target slot: a question with
 * one answer is not a question. It happens whenever nothing on the board can
 * block, and the flat rail's single "No blocks" button is already the whole
 * truth about that position.
 *
 * **Only when the enumeration finished, though.** `blockerDecision` falls back
 * to a lone empty declaration when the cap left nothing valid standing, and a
 * one-option truncated list means the opposite of a settled question — it is the
 * position with the most declarations in it, not the fewest. `autopass.ts` reads
 * the same pair of facts the same way round.
 */
export function declarationPlan(
  state: GameState,
  names: SeatNames,
  decision: Decision,
): DeclarationPlan | null {
  if (decision.kind !== 'declareAttackers' && decision.kind !== 'declareBlockers') return null;
  if (decision.options.length < 2 && decision.complete) return null;

  const byAssignment = new Map<string, number>();
  for (const [index, option] of decision.options.entries()) {
    const assignment = assignmentOf(option);
    if (assignment === null) continue;
    const key = assignmentKey(assignment);
    // First index wins: `attackerDecision` appends an "attack with everything"
    // option when it truncated, which may already be on the list, and the rail
    // must not offer one declaration under two indices.
    if (!byAssignment.has(key)) byAssignment.set(key, index);
  }

  const offered = candidatesFor(decision);
  const subjects: DeclarationSubject[] = [];
  for (const oid of decision.eligible) {
    const keys = offered.get(oid);
    if (keys === undefined || keys.length === 0) continue;
    subjects.push({
      oid,
      // A roster row is a button over one specific creature, unlike a target
      // slot: `rosterName` disambiguates two indistinguishable siblings that
      // `permanentName`'s twin qualifier deliberately leaves reading alike
      // (`mtg-rf12`).
      name: rosterName(state, oid, decision.eligible),
      candidates: keys.map((key): DeclarationCandidate => ({
        key,
        label: candidateLabel(state, names, key),
      })),
    });
  }
  if (subjects.length === 0) return null;

  return { kind: decision.kind, player: decision.player, subjects, byAssignment };
}

/**
 * What a candidate is called on the button that picks it.
 *
 * A blocker's candidate is an attacking permanent and takes the possessive form
 * `naming.ts` gives a target, because whose creature it is is part of reading
 * the board. An attacker's candidate is the defending player, whose id is in the
 * key because that is what `AttackDeclaration` carries.
 */
function candidateLabel(state: GameState, names: SeatNames, key: AssignmentKey): string {
  if (key.startsWith('player:')) return key === 'player:1' ? names[1] : names[0];
  if (key.startsWith('planeswalker:')) {
    return targetName(state, names, key.slice('planeswalker:'.length));
  }
  return targetName(state, names, key);
}

/**
 * What the panel is asking right now.
 *
 * `roster` is the list of creatures and the confirm. `target` is the one
 * follow-up question, asked only for a creature with more than one candidate,
 * which is the same rule `cast.ts` states for a target slot: a question with one
 * answer is not a question, and one attacker is the commonest combat in a game.
 */
export type DeclarationStage =
  { readonly kind: 'roster' } | { readonly kind: 'target'; readonly subject: DeclarationSubject };

export function declarationStage(plan: DeclarationPlan, asking: ObjectId | null): DeclarationStage {
  if (asking === null) return { kind: 'roster' };
  const subject = plan.subjects.find((candidate) => candidate.oid === asking);
  // A stale ask is dropped rather than drawn. The panel is scoped to
  // `session.decisions`, which is a counter and not an identity, so two
  // positions can arrive at one count (`selection.ts` lists the three ways) and
  // the creature being asked about may not be a subject of this one.
  return subject === undefined ? { kind: 'roster' } : { kind: 'target', subject };
}

/**
 * What confirming this assignment would submit, or `null` when the rules refuse
 * it.
 *
 * Two shapes and the order between them is the whole rule. An assignment the
 * kernel enumerated submits that option's index, so a game played on an ordinary
 * board records exactly the integers it recorded before any of this. One it did
 * not is offered as the declaration itself, and only once `validateAction` — the
 * kernel's own guard, re-derived from the position rather than looked up in a
 * list — says it is legal. The refusal is what keeps the half-built menace block
 * a state the panel can explain rather than a button that throws.
 */
export function declarationChoice(
  state: GameState,
  plan: DeclarationPlan,
  assignment: Assignment,
): Choice | null {
  const index = plan.byAssignment.get(assignmentKey(assignment));
  if (index !== undefined) return index;
  const action = actionOf(plan, assignment);
  if (action === null) return null;
  return validateAction(state, action) === null ? action : null;
}

/**
 * What pressing a creature on the roster does.
 *
 * One rule: change this creature's assignment, and ask which change only when
 * there is more than one. A creature with a single candidate toggles between
 * declared and not, which is every block against a lone attacker and every
 * attack in this game, since `attackerDecision` gives each attacker one
 * defender. A creature with several opens the question, with declining among the
 * answers so the same press is also how a mistake is taken back.
 */
export type RosterPress =
  | { readonly kind: 'assign'; readonly oid: ObjectId; readonly to: AssignmentKey | null }
  | { readonly kind: 'ask'; readonly oid: ObjectId };

export function rosterPress(subject: DeclarationSubject, assignment: Assignment): RosterPress {
  const held = assignment.get(subject.oid);
  const only = subject.candidates[0];
  if (subject.candidates.length === 1 && only !== undefined) {
    return { kind: 'assign', oid: subject.oid, to: held === undefined ? only.key : null };
  }
  return { kind: 'ask', oid: subject.oid };
}

/** The assignment with one creature's answer replaced, or removed for `null`. */
export function withAssignment(assignment: Assignment, oid: ObjectId, to: AssignmentKey | null): Assignment {
  const next = new Map(assignment);
  if (to === null) next.delete(oid);
  else next.set(oid, to);
  return next;
}

/**
 * The same declaration read as a gesture on the table: which cards may be
 * pressed, which card is being asked about, and which cards answer it.
 *
 * `mtg-bz2.5`'s board half. the playtester, 2026-08-14, having played a real combat:
 * "it felt really awkward to try to block an attacker", said against "I could
 * click it and move it into the combat zone at least" about attacking. The
 * asymmetry she hit is not only that blocking had no gesture. Measured on this
 * checkout at 1440x900 on a three-attacker, four-blocker board (108 legal
 * declarations): every eligible blocker was drawn with the amber ring the rest
 * of this table spends on "you may act on this", and a click on one opened a
 * picker of **72 whole declarations** — "Quarry Hound blocks Ember Courser;
 * Verge Harrier blocks Salt Marsh Drover; Palisade Outrider blocks …" — which is
 * exactly the flat list `mtg-y1t` took out of the rail, still hanging off every
 * card. On a one-legal-block board the same click **submitted the whole
 * declaration outright**, with no staging and no confirm, while the attack one
 * step earlier stages on the first click and commits only at a button.
 *
 * So the board press goes through this model instead, and the model is the one
 * the roster already runs. **Nothing here is a second opinion**: `pressable` is
 * the plan's own subjects, `answers` is the asked creature's own candidates, and
 * the assignment is the panel's. Wiring a card to `rosterPress` rather than to a
 * parallel rule is what keeps the two surfaces from disagreeing about what a
 * press means.
 *
 * **Blocker first, attacker second.** It is what `mtg-bz2.5` asked for in the
 * first place — "select a blocker then select the attacking creature it blocks,
 * and display the relationship visually, then confirm blockers" — and the bead
 * was closed with that half unbuilt, so the direction is the filer's rather than
 * this lane's. It is also the right one, and the argument is the commonest
 * combat.
 * One attacker is most combats, and against one attacker the kernel gives every
 * blocker exactly one candidate — so `rosterPress` assigns on the press and this
 * surface's own rule holds, that a question with one answer is not a question.
 * Selecting the attacker first would put a click carrying no information in
 * front of every block on that board. Attacker-first is cheaper only when
 * several creatures gang up on one attacker (n+1 presses against 2n), which is
 * the minority combat and the one the panel's answer list already serves
 * fastest. Dragging was the third candidate and is not built: no drag exists
 * anywhere on this surface, the band is a horizontal scroller and a drop target
 * that scrolls under the pointer is the worst one, and a drag needs a keyboard
 * equivalent that would be a second model of the same assignment.
 */
export interface BlockAssignment {
  /** The attacking permanent, by the id the board keys its cards on. */
  readonly attacker: ObjectId;
  /** And as the panel already says it — `Bot's Ember Courser` (`naming.ts`). */
  readonly label: string;
}

export interface BlockGesture {
  /** Creatures a press may reach. Empty at every decision that is not a block. */
  readonly pressable: ReadonlySet<ObjectId>;
  /** The creature whose question is open, or null. */
  readonly asking: ObjectId | null;
  /**
   * The attackers that answer that question, which is the asked creature's own
   * candidate list. Empty while nothing is being asked, so no attacker is drawn
   * as a control at a moment when pressing one would mean nothing.
   */
  readonly answers: ReadonlySet<ObjectId>;
  /** What each creature is assigned to block. */
  readonly assigned: ReadonlyMap<ObjectId, BlockAssignment>;
}

/** The gesture nothing is offering: no decision, or a decision that is not a block. */
export const NO_BLOCK_GESTURE: BlockGesture = {
  pressable: new Set<ObjectId>(),
  asking: null,
  answers: new Set<ObjectId>(),
  assigned: new Map<ObjectId, BlockAssignment>(),
};

/**
 * The three fields a declaration in progress is, named structurally.
 *
 * `selection.ts`'s `DeclarationControl` satisfies it and this module cannot name
 * that type: the arrow already runs the other way, and closing it would be a
 * cycle. The board reads the declaration through this shape instead.
 */
export interface DeclarationView {
  readonly plan: DeclarationPlan;
  readonly stage: DeclarationStage;
  readonly assignment: Assignment;
}

export function blockGesture(view: DeclarationView | null): BlockGesture {
  if (view === null || view.plan.kind !== 'declareBlockers') return NO_BLOCK_GESTURE;
  const asked = view.stage.kind === 'target' ? view.stage.subject : null;
  const assigned = new Map<ObjectId, BlockAssignment>();
  for (const subject of view.plan.subjects) {
    const held = view.assignment.get(subject.oid);
    if (held === undefined) continue;
    const candidate = subject.candidates.find((one) => one.key === held);
    // A block's assignment key is the attacking permanent's own id
    // (`assignmentOf`), so the key is the attacker and the label is the one the
    // panel would print beside it. A held key the subject no longer offers is
    // dropped rather than named: the assignment is scoped to a decision *count*
    // and two positions can share one, so this is the same staleness the roster
    // answers by finding no index for it.
    if (candidate === undefined) continue;
    assigned.set(subject.oid, { attacker: held, label: candidate.label });
  }
  return {
    pressable: new Set(view.plan.subjects.map((subject) => subject.oid)),
    asking: asked?.oid ?? null,
    answers: new Set(asked === null ? [] : asked.candidates.map((candidate) => candidate.key)),
    assigned,
  };
}
