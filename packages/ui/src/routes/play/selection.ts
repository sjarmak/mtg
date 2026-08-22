/**
 * What the table has selected, and which card's menu is open.
 *
 * **Three gestures on one card** (`mtg-bz2.2`), and the whole of the difference
 * between them is how much each is allowed to decide. `select` is a single
 * click: it plays the card's one move, or opens the menu when there are several,
 * so it decides nothing the player could not read off the card. `activate` is a
 * double click and plays the card's default move, which `default-action.ts`
 * defines structurally and refuses to invent. `openMenu` is a right click or the
 * context key, and it decides least of all — it opens the list and waits.
 *
 * The playtester's constraint is what that ordering is for: *do not make the UI
 * excessively infer intent*. Where two readings of a gesture are both plausible
 * the surface opens a menu instead of guessing, and the one place that could
 * have been a ranking table is a structural test instead.
 *
 * The only state the play view owns. Everything else on that surface is derived
 * from the session, which `use-session.ts` holds — so this module is the whole
 * of "interaction state", and it has a file of its own because four of
 * `mtg-bz2`'s lanes want to add to it. A staged cast (`mtg-bz2.3`), a click-built
 * attack and block (`mtg-bz2.5`), a target chosen on the battlefield
 * (`mtg-bz2.6`) and a chosen mana payment (`mtg-bz2.8`) are all additions here
 * rather than to the view that composes it.
 *
 * **`mtg-bz2.13` was a fifth and turned out not to be** (2026-08-13), and the
 * reason is worth keeping because the two mechanisms it separates are easy to
 * confuse. the playtester named both in one sentence: "selecting attackers can be
 * changed before submitting attackers. Once priority is passed or a
 * hidden-information-changing action resolves, it cannot simply be undone." The
 * first half is this file. Changing a declaration before it is submitted is
 * interaction state that never reached the kernel, so there is nothing to take
 * back and no boundary to check — the cancel path a staging lane owes is the
 * whole of it. The second half is a rewind of the kernel, and it lives in
 * `use-session.ts` over `@mtg/kernel`'s `undo.ts`. Nothing about a commit
 * boundary is decided here, and a lane that added one here would be deciding it
 * twice.
 *
 * **It now holds one partially-built action: a cast in progress** (`mtg-bz2.3`,
 * 2026-08-13). Everything else is still the old property — a click either
 * submits an enumerated index or opens a menu of enumerated indices — and the
 * cast is a narrower exception than it looks. `cast.ts` walks the kernel's own
 * enumeration one target slot at a time and finishes on the single option the
 * answers leave standing, so what the last press submits is still an index into
 * `decision.options` and the surface still cannot name a move the kernel did not
 * offer. `chooseAction` (`@mtg/kernel`'s `session.ts`) is the door a lane needs
 * when its move is genuinely constructed — a click-built block declaration is —
 * and this lane does not need it.
 *
 * The cancel path a staging lane owes is both halves of `picks`: a step back
 * drops the last answer, and a cancel drops the list. Neither one is a rewind. A
 * staged cast has never reached the kernel, so there is nothing recorded to take
 * back and no commit boundary to check, which is exactly the distinction the
 * paragraph above draws.
 *
 * **It now holds a second partially-built action: a combat declaration**
 * (`mtg-y1t`, 2026-08-14). The paragraph above predicted it — "a click-built
 * attack and block (`mtg-bz2.5`)" was named as an addition here rather than to
 * the view that composes it — and half of that lane has arrived early, because
 * `declareAttackers` and `declareBlockers` are the two decisions whose
 * enumeration is exponential in the creatures on the board and a real game
 * reached 256 of them in one column. `declare.ts` argues the shape.
 *
 * It is the same narrow exception the cast is. The assignment is interaction
 * state that has never reached the kernel; every candidate it offers came out of
 * `Decision.options`; and the confirm submits the index of the enumerated
 * declaration the assignment names, so the last press is an integer like every
 * other press on this surface. **What is still owed to `mtg-bz2.5` is the board
 * half** — clicking a creature on the table to assign it, and drawing the
 * blocking relationship between the two cards. The state that lane needs is this
 * one, and `assign` is the function it wires a click to.
 *
 * **`mtg-bz2.6` arrived and added no state at all** (2026-08-16). A target
 * chosen on the battlefield was named above as a fourth addition here, and what
 * it needed was already present: a cast's answers are `picks`, and the slot
 * being asked is what `castStage` makes of them. So `targeting` is a third
 * derived control beside `declaration` and `ordering`, and the one new thing on
 * this surface is that a click on a lit card calls `aim` instead of the panel's
 * button calling `onPick`. Both write the same list.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Action, Decision, GameState, ObjectId } from '@mtg/kernel';
import { castStage } from './cast';
import type { CastPick, CastPlan, CastStage, CastTargetStage } from './cast';
import { castPanel } from './cast-panel';
import { unfoldedName } from './choice-button';
import { declarationChoice, declarationPlan, declarationStage, rosterPress, withAssignment } from './declare';
import type { DeclarationConfirm } from './declare-panel';
import type { Assignment, DeclarationPlan, DeclarationStage, DeclarationSubject } from './declare';
import { defaultChoice } from './default-action';
import { focusedNode } from './focus';
import type { FocusableNode } from './focus';
import { NOTHING_ORDERED, clearedOrder, orderChoice, orderPlan, withPress } from './order';
import type { OrderBlocker, OrderGroup, OrderPlan, Ordering } from './order';
import type { OrderConfirm } from './order-panel';
import { pickerPanel } from './picker';
import type { SeatNames } from './position';
import { choiceText } from './prompt';
import type { PlayChoice } from './prompt';
import { aimableTargets } from './targeting';

/**
 * Which gesture opened the menu, which is the one thing the two openings differ
 * on.
 *
 * A click opens a menu only when the card has a move to disambiguate, so a
 * click-opened menu holding one option would be offering the move the click
 * itself plays. A right click opens the menu the player asked for, and one
 * option is the whole point of asking: it is how you read what a click on that
 * card would commit you to before committing to it. `pickerFor`'s guard is the
 * only place the difference is spent.
 */
type OpenVia = 'click' | 'menu';

/**
 * Which card has its picker open, which decision it was opened against, and how.
 *
 * The decision count rather than an effect: the next decision is a different set
 * of moves, so a picker outlives its own list by exactly zero renders. Comparing
 * the count closes it without React ever running a cleanup, which means a
 * server-rendered table and a live one agree about what is on screen.
 */
interface OpenPicker {
  readonly decisions: number;
  readonly key: string;
  readonly via: OpenVia;
}

export interface SelectionInput {
  /** `session.decisions`, which is what an open picker is scoped to. */
  readonly decisions: number;
  /** The enumeration read from the object end; `prompt.ts` builds it. */
  readonly byObject: ReadonlyMap<string, readonly PlayChoice[]>;
  /**
   * The staged cast available for each castable card; `cast.ts` builds it off
   * the same enumeration. A card with a plan opens the cast panel instead of the
   * picker, however many aimings it has, because the payment is worth seeing
   * even when the aim was never in question.
   */
  readonly castPlans: ReadonlyMap<string, CastPlan>;
  /**
   * What the kernel is asking, or null when it is asking nothing.
   *
   * Only the combat declarations read it, and they read it whole rather than
   * through `byObject`: an assignment is a pairing of two objects, and the map
   * above keys a choice by each object it names without saying which side of the
   * pair it was.
   */
  readonly decision: Decision | null;
  /** Read for the labels a stage puts on targets; nothing here decides legality. */
  readonly state: GameState;
  readonly names: SeatNames;
  readonly onChoose: (index: number) => void;
}

/**
 * Which surface a roster press came from — the rail's row, or the card itself.
 *
 * The one thing it decides is where the focus ring goes when a question opens;
 * `DeclarationControl.answerFocus` states the rule. Nothing about the
 * declaration differs, and nothing about it reaches the kernel either way.
 */
export type PressOrigin = 'panel' | 'board';

/**
 * A combat declaration being assembled, and the four ways to change it.
 *
 * `confirm` is the whole of the seam to the kernel: what submitting this
 * assignment would send, or null when the rules refuse it — one blocker on a
 * creature with menace, which is a legal position to be halfway through and an
 * illegal one to submit. `declare.ts` carries which of the two shapes it is and
 * why the answer is not always an index.
 */
export interface DeclarationControl {
  readonly plan: DeclarationPlan;
  readonly stage: DeclarationStage;
  readonly assignment: Assignment;
  readonly confirm: DeclarationConfirm | null;
  /**
   * The creature whose row takes the focus ring when the roster is next drawn,
   * or null on the roster the panel opened on.
   *
   * The keyboard half of the question stage, and it exists because the roster is
   * *unmounted* while a question is open. `dismiss` above hands the ring back by
   * holding the node that opened the picker, which works because the card that
   * opened it is still on the table; a row that has been replaced by the
   * question is a detached node, and focusing one does nothing. So the ring is
   * handed forward instead: the row mounts with `autoFocus`, which is
   * `cast-panel.ts`'s mechanism for the same job. Null on first draw, because a
   * prompt appearing must not take the ring off whatever the player is using.
   */
  readonly focus: ObjectId | null;
  /**
   * Whether the open question's first answer should take the ring as it mounts.
   *
   * True for a question opened from the panel, which is `cast-panel.ts`'s rule —
   * a panel that opens behind the keyboard is a panel the keyboard has to go
   * looking for. False for one opened by pressing a card on the table, where the
   * ring is already on the card the player is looking at and pulling it into a
   * 148px side column would move it away from the gesture they are in the middle
   * of. The question is the same question either way and both surfaces draw it;
   * only the ring differs, which is why this is a flag rather than a second
   * stage.
   */
  readonly answerFocus: boolean;
  /**
   * Presses a creature: toggles it, or opens its question (`declare.ts`).
   *
   * `from` is where the press came from, and it decides only the ring above.
   */
  readonly press: (subject: DeclarationSubject, from?: PressOrigin) => void;
  /** Answers an open question, `null` declining. Also the board half's door. */
  readonly assign: (oid: ObjectId, key: string | null, from?: PressOrigin) => void;
  /** Leaves an open question unanswered. */
  readonly back: (from?: PressOrigin) => void;
  /** Drops every assignment. Nothing has reached the kernel. */
  readonly clear: () => void;
  /**
   * Replaces the whole assignment in one write, for a caller that means to
   * stage several creatures at once — `combat.ts`'s "Attack with all".
   *
   * `assign` answers one creature's question, and a loop of it over several
   * creatures would still write one at a time against the `assignment` the
   * render that started the loop closed over, so every write but the last
   * would be discarded rather than accumulated. This is the whole assignment
   * going over in a single `setDeclaring`, which is the only way several
   * creatures land in state from one gesture.
   */
  readonly setAssignment: (assignment: Assignment) => void;
}

/**
 * What is assigned, scoped to the decision it was assigned against.
 *
 * The decision *count* rather than an identity, which is the bookkeeping
 * `OpenPicker` above already uses and which `castStage` and `pickerFor` both
 * carry a staleness guard for. This one needs no guard of its own: a stale
 * assignment names object ids the new position may not have, so
 * `declarationChoice` finds nothing legal for it and the confirm is simply absent.
 * Comparing the count drops it before that can happen.
 */
interface OpenDeclaration {
  readonly decisions: number;
  readonly assignment: Assignment;
  readonly asking: ObjectId | null;
  /** Which row the ring goes to when the roster comes back; see `focus` above. */
  readonly answered: ObjectId | null;
  /** Where the press that opened the question came from; see `PressOrigin`. */
  readonly from: PressOrigin;
}

const NOTHING_ASSIGNED: Assignment = new Map<ObjectId, string>();

/**
 * A damage assignment order being built, and the two ways to change it.
 *
 * The third partially-built action on this surface, and the narrowest: an
 * ordering has no per-creature question to open, so there is no stage, no ring to
 * hand forward and no press origin. One press places a blocker or takes it back
 * out, and that is the whole vocabulary. `order.ts` argues why the decision needs
 * a builder at all — the same reason the two declarations do, one order of
 * magnitude worse.
 */
export interface OrderControl {
  readonly plan: OrderPlan;
  readonly ordering: Ordering;
  /** What submitting this order would send, or null while a blocker is unplaced. */
  readonly confirm: OrderConfirm | null;
  /** Places a blocker next in its attacker's order, or takes it back out. */
  readonly press: (group: OrderGroup, blocker: OrderBlocker) => void;
  /** Drops every placement. Nothing has reached the kernel. */
  readonly clear: () => void;
}

/**
 * The target slot a staged cast is waiting on, and the one way to answer it from
 * the board.
 *
 * The fourth partially-built action reachable from the table, and the only one
 * that is not a fourth *state*: a cast already holds its answers in `picks`, and
 * this is that same list read one question at a time. `mtg-bz2.6` asked for the
 * board half of it — legal targets lit where the cards are, illegal ones visibly
 * inert — and the panel keeps the complete candidate list, players and spells on
 * the stack included, for the reason the rail keeps the complete move list.
 *
 * `aim` takes an object id rather than a `Target` because the board has one: a
 * click arrives carrying the key its card is drawn under. `targeting.ts` holds
 * the lookup and both surfaces use it, so what lights and what may be pressed
 * are one derivation.
 */
export interface TargetControl {
  /** The spell being aimed, by the id the board keys its card on. */
  readonly oid: ObjectId;
  /** The open slot and its candidates, exactly as the panel is drawing them. */
  readonly stage: CastTargetStage;
  /** Aims the open slot at a permanent. A no-op for an id the slot does not name. */
  readonly aim: (oid: ObjectId) => void;
}

/** What is placed, scoped to the decision it was placed against (`OpenDeclaration`). */
interface OpenOrder {
  readonly decisions: number;
  readonly ordering: Ordering;
}

export interface TableSelection {
  /** The object whose picker is open, or null. */
  readonly openKey: string | null;
  /** A click on a card face: play its one move, or open its menu. */
  readonly select: (key: string) => void;
  /** A double click: play the card's default move, when it has one. */
  readonly activate: (key: string) => void;
  /** A right click or the context key: open the card's menu, whatever it holds. */
  readonly openMenu: (key: string) => void;
  /** Drops the open picker and hands the focus ring back to the card it hung on. */
  readonly dismiss: () => void;
  /** The picker for one card, when it is that card's turn to hold it. */
  readonly pickerFor: (key: string, cardName: string) => ReactNode;
  /** The combat declaration being assembled, or null at every other decision. */
  readonly declaration: DeclarationControl | null;
  /** The damage assignment order being assembled, or null at every other decision. */
  readonly ordering: OrderControl | null;
  /**
   * The target slot the staged cast is waiting on, or null whenever no cast is
   * open and whenever the open one has reached its payment.
   */
  readonly targeting: TargetControl | null;
}

export function useTableSelection(input: SelectionInput): TableSelection {
  const { decisions, byObject, castPlans, decision, state, names, onChoose } = input;
  const [picking, setPicking] = useState<OpenPicker | null>(null);
  const [declaring, setDeclaring] = useState<OpenDeclaration | null>(null);
  const [ordering, setOrdering] = useState<OpenOrder | null>(null);
  // What a staged cast has been aimed at so far, oldest answer first. Empty
  // whenever the panel opens, so a cast never inherits the last one's answers.
  const [picks, setPicks] = useState<readonly CastPick[]>([]);
  // The card that opened the picker, caught while it still holds the ring. A ref
  // rather than state because nothing on screen is drawn from it.
  const openedBy = useRef<FocusableNode | null>(null);
  const openKey = picking !== null && picking.decisions === decisions ? picking.key : null;
  // The staged cast and the question it is on, derived once and read by both
  // surfaces that draw it: the panel below and, through `targeting`, the board.
  // One `castStage` call rather than one per surface, because two calls are two
  // chances for the lit cards and the listed buttons to answer different
  // questions — `mtg-5t05`'s defect, which is what `targeting.ts` is shaped to
  // avoid.
  const openPlan = openKey === null ? undefined : castPlans.get(openKey);
  const openStage = openPlan === undefined ? null : castStage(state, names, openPlan, picks);

  function dismiss(): void {
    const opener = openedBy.current;
    openedBy.current = null;
    setPicking(null);
    setPicks([]);
    // Before React re-renders, so the card is still in the document to take it.
    // A card the choice removed from the table cannot, and the ring falls to the
    // body there, which is what a card leaving the screen costs either way.
    opener?.focus();
  }

  function open(key: string, via: OpenVia): void {
    openedBy.current = focusedNode();
    setPicks([]);
    setPicking({ decisions, key, via });
  }

  function select(key: string): void {
    const choices = byObject.get(key) ?? [];
    const only = choices[0];
    if (only === undefined) return;
    if (openKey === key) {
      // Clicking the card whose panel is already open closes it. For a picker
      // that is a menu being dismissed; for a staged cast it is the cancel, and
      // both are local — nothing was ever submitted.
      dismiss();
      return;
    }
    // A castable card goes to the staged flow even when it has one aiming,
    // because the stage that always has something to say is the payment.
    if (castPlans.has(key)) {
      open(key, 'click');
      return;
    }
    if (choices.length === 1) {
      openedBy.current = null;
      setPicking(null);
      setPicks([]);
      onChoose(only.index);
      return;
    }
    open(key, 'click');
  }

  /**
   * A double click: the card's default move, submitted without the menu.
   *
   * It answers only for a card with more than one move, and that is not a
   * shortcut — it is why the gesture needs no timer and no swallowed click. On a
   * card with one move the first click of the pair has already submitted it, so
   * by the time a double click is delivered there is nothing left for it to do;
   * on a card with several the first click opened the menu and the second closed
   * it again, and this is what happens next. Either way the two gestures never
   * both act, and the double click a player makes on a land still taps it.
   *
   * A card with no default (`default-action.ts` states the rule) is left exactly
   * as the two clicks left it: nothing submitted, and the menu closed. That is
   * the constraint being kept rather than a gap — the surface has no honest
   * answer for which of two aims was meant, so it does not invent one. Reopening
   * the menu here would be a third meaning for a gesture the player used to say
   * "skip the menu".
   */
  function activate(key: string): void {
    // A castable card has no default worth submitting, whatever its move count.
    // The staged cast exists because the payment is the stage that always has
    // something to say, and a double click that submitted an aiming outright
    // would be the one gesture that skips it. This is the same refusal the rule
    // below makes for a card with two aims, arrived at one step earlier.
    if (castPlans.has(key)) {
      open(key, 'click');
      return;
    }
    const choices = byObject.get(key) ?? [];
    if (choices.length < 2) return;
    const move = defaultChoice(choices);
    if (move === null) return;
    openedBy.current = null;
    setPicking(null);
    onChoose(move.index);
  }

  /**
   * A right click or the context key: this card's menu, whatever it holds.
   *
   * The one opening that does not care how many moves the card has. A card with
   * a single move is the interesting case: a click plays that move outright, and
   * this is how the player reads what it is first. A card with none opens
   * nothing, because an empty menu titled with a card says less than the card's
   * own inertness already does.
   *
   * Idempotent on the card it is already open on, rather than a toggle. Closing
   * is the click's job and Escape's; a second right click that closed the menu
   * would make the gesture mean two things depending on state, which is the
   * inference this lane is avoiding.
   */
  function openMenu(key: string): void {
    if (openKey === key) return;
    const choices = byObject.get(key) ?? [];
    if (choices.length === 0) return;
    open(key, 'menu');
  }

  /**
   * The guard below is not dead and the branch is not empty. `select` never
   * names a card it found fewer than two choices on, so no click of the
   * player's own reaches it. A session does. The view owns no game state:
   * `picking` survives a re-render by comparing `session.decisions`, and that is
   * a counter rather than an identity. Two sessions at one count are two
   * different positions, and one object id does not carry the same moves in
   * both. `advance` re-settles a session without submitting a choice and leaves
   * the count alone, `usePlaySession`'s `restart` lands on the length of the
   * replayed choice log, and `PlayView`'s contract is a session handed in from
   * outside, which is what lets one view serve a live game and a resumed
   * recording.
   *
   * Without the guard, both halves of `< 2` draw something wrong on a card
   * nobody clicked: nothing at all is an empty menu titled with that card, and a
   * single move is a menu offering the one move a click on the card already
   * plays outright. `test/play/click.test.ts` enters both, from one object id in
   * two positions at one decision count.
   *
   * The floor is the opening gesture's, which is the whole of what `via`
   * records. A menu the player asked for by right-clicking is drawn on one move,
   * because reading the move before playing it is what they asked for; the
   * stale-session halves are unaffected, since the empty menu is refused either
   * way and the list is read fresh from `byObject` on every render rather than
   * carried in the open picker.
   */
  function pickerFor(key: string, cardName: string): ReactNode {
    if (picking === null || picking.key !== key || openKey !== key) return null;
    if (openPlan !== undefined) return openStage === null ? null : castFor(openPlan, openStage);
    const choices = byObject.get(key) ?? [];
    if (choices.length < (picking.via === 'menu' ? 1 : 2)) return null;
    return pickerPanel(cardName, choices, (index) => {
      dismiss();
      onChoose(index);
    });
  }

  /**
   * The staged cast, or nothing when the answers no longer name a cast the
   * kernel is offering.
   *
   * `castStage` returning null is the same staleness the guard above answers, in
   * the same way and for the same reason: a panel is scoped to a decision
   * *count*, and two positions can share one. Drawing a stage over an empty
   * option list would be a panel asking about a spell that is no longer castable.
   * The null is caught at the call above; the stage is handed in rather than
   * derived here so that the panel and the board draw one question (`openStage`).
   */
  function castFor(plan: CastPlan, stage: CastStage): ReactNode {
    return castPanel({
      plan,
      stage,
      onPick: (pick: CastPick): void => {
        setPicks([...picks, pick]);
      },
      onBack:
        picks.length === 0
          ? null
          : (): void => {
              setPicks(picks.slice(0, -1));
            },
      onCancel: dismiss,
      onChoose: (index: number): void => {
        dismiss();
        onChoose(index);
      },
    });
  }

  /**
   * The declaration being assembled, or null when the kernel is asking anything
   * else.
   *
   * Rebuilt on every render rather than memoized, exactly as `byObject` and
   * `castPlans` are: it is a pure function of the decision, and holding it would
   * be a second copy of the enumeration that could fall behind the first.
   */
  function declarationControl(): DeclarationControl | null {
    if (decision === null) return null;
    const plan = declarationPlan(state, names, decision);
    if (plan === null) return null;
    const live = declaring !== null && declaring.decisions === decisions ? declaring : null;
    const assignment = live?.assignment ?? NOTHING_ASSIGNED;
    const write = (
      next: Assignment,
      asking: ObjectId | null,
      answered: ObjectId | null,
      from: PressOrigin = 'panel',
    ): void => {
      setDeclaring({ decisions, assignment: next, asking, answered, from });
    };
    const choice = declarationChoice(state, plan, assignment);
    return {
      plan,
      stage: declarationStage(plan, live?.asking ?? null),
      assignment,
      // The confirm announces itself in the words the flat list gave the move,
      // whichever shape it submits: `choiceText` is what built those words.
      confirm:
        choice === null
          ? null
          : {
              choice,
              name: unfoldedName(
                typeof choice === 'number'
                  ? choiceText(state, names, decision.options[choice] as Action)
                  : choiceText(state, names, choice),
              ),
            },
      // Handed forward only when the press was in the panel, which is the one
      // rule both rings answer to: a press on a card leaves the ring on that
      // card, where the player is, and a press in the column keeps it in the
      // column. Without the gate, answering a board question by clicking an
      // attacker would throw the ring into a 148px rail nobody was reading.
      focus: (live?.from ?? 'panel') === 'panel' ? (live?.answered ?? null) : null,
      answerFocus: (live?.from ?? 'panel') === 'panel',
      press: (subject: DeclarationSubject, from: PressOrigin = 'panel'): void => {
        const press = rosterPress(subject, assignment);
        // A toggle keeps the ring where it is: the row is the same button before
        // and after, so nothing is unmounted and nothing has to be handed back.
        if (press.kind === 'ask') write(assignment, press.oid, null, from);
        else write(withAssignment(assignment, press.oid, press.to), null, null, from);
      },
      // Answering closes the question, which is what makes the roster the place
      // a player always ends up: every answer is one press and one step back.
      assign: (oid: ObjectId, key: string | null, from: PressOrigin = 'panel'): void => {
        write(withAssignment(assignment, oid, key), null, oid, from);
      },
      back: (from: PressOrigin = 'panel'): void => {
        write(assignment, null, live?.asking ?? null, from);
      },
      clear: (): void => {
        write(NOTHING_ASSIGNED, null, null);
      },
      setAssignment: (next: Assignment): void => {
        write(next, null, null);
      },
    };
  }

  /**
   * The damage assignment order being assembled, or null at every other decision.
   *
   * Rebuilt every render for `declarationControl`'s reason, and scoped to the
   * decision count the same way. The staleness guard it needs is the same one and
   * it is already there: a placement carried into another position names object
   * ids that position may not have, `validateAction` refuses the ordering they
   * spell, and the confirm is absent rather than wrong.
   */
  function orderingControl(): OrderControl | null {
    if (decision === null) return null;
    const plan = orderPlan(state, names, decision);
    if (plan === null) return null;
    const live = ordering !== null && ordering.decisions === decisions ? ordering : null;
    const placed = live?.ordering ?? NOTHING_ORDERED;
    const choice = orderChoice(state, plan, placed);
    return {
      plan,
      ordering: placed,
      // The confirm announces itself in the words the flat list gave the move,
      // whichever shape it submits — `declarationControl` above states the rule
      // and `choiceText` is what built those words.
      confirm:
        choice === null
          ? null
          : {
              choice,
              name: unfoldedName(
                typeof choice === 'number'
                  ? choiceText(state, names, decision.options[choice] as Action)
                  : choiceText(state, names, choice),
              ),
            },
      press: (group: OrderGroup, blocker: OrderBlocker): void => {
        setOrdering({ decisions, ordering: withPress(placed, group, blocker.oid) });
      },
      clear: (): void => {
        setOrdering({ decisions, ordering: clearedOrder() });
      },
    };
  }

  /**
   * The target slot the open cast is waiting on, or null.
   *
   * Derived from the same `openStage` the panel is drawing rather than from a
   * second walk of the picks, which is the whole of `mtg-bz2.6`'s state design:
   * the board is a view over an answer list that already exists. It needs no
   * staleness guard of its own because `castStage` is the guard — a pick list
   * that names no enumerated cast returns null there, and this returns null with
   * it.
   */
  function targetControl(): TargetControl | null {
    if (openPlan === undefined || openStage === null || openStage.kind !== 'targets') return null;
    const stage = openStage;
    return {
      oid: openPlan.oid,
      stage,
      aim: (oid: ObjectId): void => {
        const target = aimableTargets(stage).get(oid);
        // A permanent the slot never named. The board draws it inert, so this is
        // unreachable by pointer; it is the guard that keeps that true rather
        // than assumed, in the way `pressOrderBlocker` guards its own lookup.
        if (target === undefined) return;
        setPicks([...picks, { kind: 'target', slot: stage.slot, target }]);
      },
    };
  }

  return {
    openKey,
    select,
    activate,
    openMenu,
    dismiss,
    pickerFor,
    declaration: declarationControl(),
    ordering: orderingControl(),
    targeting: targetControl(),
  };
}
