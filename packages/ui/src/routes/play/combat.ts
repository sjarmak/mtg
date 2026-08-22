/**
 * Building an attack by clicking, and the boundary it is submitted across.
 *
 * `mtg-bz2.5`, specified by the person who filed it. the playtester, 2026-08-14:
 * "when it's declare attackers step I should be able to click a card and then it
 * moves it up slightly into the combat zone and then click it again to not
 * actually declare it as an attacker yet, so e.g. if I have multiple creatures
 * to choose to attack with I can click those creatures and then select 'declare
 * attackers' … and alternatively have an 'attack with all' button as well".
 *
 * # Staging is view state and reaches nothing
 *
 * A half-built attack is not a decision anybody has taken. Nothing here appends
 * to `choices`, reaches a `GameState` field or is visible to `stateFingerprint`,
 * so a game replayed from its seed cannot tell a player who staged four
 * creatures and unstaged one from a player who staged three. That is the same
 * rule `@mtg/kernel`'s `beats.ts` holds for the combat pauses and `selection.ts`
 * holds for a staged cast, and it is the reason the staged set lives beside the
 * open picker rather than anywhere near the session.
 *
 * The kernel sees exactly one choice for the whole declaration, at the confirm.
 *
 * # What the enumeration actually contains, checked rather than assumed
 *
 * `@mtg/kernel`'s `attackerDecision` builds the **power set** of
 * `eligibleAttackers` — `subsets(eligible, cap)` — and every option carries its
 * attackers *structurally*, as `AttackDeclaration[]` with an `oid` and a
 * `defender`. So confirming is a lookup by set equality over `decision.options`
 * and never a label parsed back into a set. `eligible` is on the decision too,
 * which is what makes "attack with all" a legal question the kernel has already
 * answered rather than one this file would have to re-derive from tapped and
 * summoning-sick flags.
 *
 * # The cap, and why the confirm no longer stops at it
 *
 * The subset enumeration is capped like every other, at the same 512, and a deck
 * of big creatures walks straight past it. Measured on this checkout against
 * `attackerDecision` (`@mtg/kernel`'s `test/attack-enumeration.test.ts` holds the
 * whole table): nine eligible attackers enumerate all 512 subsets, ten enumerate
 * 512 of 1024, and twelve enumerate 512 of 4096. `mtg-dwd`.
 *
 * A bigger cap is the wrong fix twice over. 2^n outruns any constant — 4096 buys
 * two more creatures and then fails identically — and the truncation is not a
 * uniform sample of the declarations either. `subsets` grows the lattice one
 * creature at a time, so the 512 options are every subset of the *first nine*
 * eligible creatures whatever the board holds; the tenth onward are named in no
 * option but the attack-with-everything the kernel appends. A confirm reading
 * only `options` could not stage the tenth creature into anything except the
 * whole board.
 *
 * So the confirm submits a `Choice` rather than an index, which is the same
 * answer `mtg-y1t.2` gave the block half one step later in combat and the reason
 * that half needed no second mechanism: an enumerated set records the integer it
 * always did, and a set the truncation dropped records the declaration itself
 * (`@mtg/kernel`'s `chooseAction`, and `@mtg/netplay`'s `declare` request over a
 * wire). `attackChoice` below is `declare.ts`'s `declarationChoice` for a set
 * instead of an assignment, and it is total: every subset of `eligible` is a
 * legal declaration (`validateAttackers` checks eligibility, no duplicates and
 * the defender, and a subset satisfies all three), so unlike a block there is no
 * half-built attack the rules refuse and no disabled confirm to explain.
 *
 * # How this extends to blockers, and where that ended up
 *
 * A block is an assignment rather than a set (CR 509.1a), so the staged value is
 * a map from blocker to attacker instead of a set of attackers. The paragraph
 * that stood here predicted the map would live beside the set above. It does
 * not: `declare.ts` already held that map — `mtg-y1t` needed it for the roster
 * in the rail — so the block's staging is `selection.ts`'s `DeclarationControl`,
 * and `blockControls` below is the mirror of `attackControls` reading the
 * panel's state instead of its own.
 *
 * # The attack half kept its own set for one lane too many (`mtg-5t05`)
 *
 * The paragraph that used to stand here argued the asymmetry was honest: the
 * board staging (`mtg-bz2.5`) was built before the roster's `DeclarationControl`
 * existed, so `useAttackStaging` grew a `useState` of its own rather than
 * reaching for a control that was not there yet. Once both existed, the set here
 * and the `Assignment` in `selection.ts` were two independent records of one
 * declaration — a click on a creature's face moved this file's set and left the
 * roster's rows reading "not attacking", and a roster press moved the roster and
 * left the band reading "Attack with nothing". Two live confirms, each honest
 * about a different half of what the player had staged.
 *
 * So `useAttackStaging` no longer holds state: it is a view over the
 * `DeclarationControl` the roster already writes to, translating between the
 * `ReadonlySet<string>` this file's callers expect and the `Assignment` the
 * control holds. `toggle` is `press` for the one-candidate case every board
 * attacker is (`eligible` is empty whenever `decision.defenders.length !== 1`,
 * and every subject built for a single defender has exactly one candidate), and
 * `stageAll` is `setAssignment` — the whole-assignment write `declare.ts`'s
 * `assign` cannot do on its own, since a loop of single answers would each close
 * over the same stale assignment and keep only the last. The interface below is
 * unchanged, so `table.ts`'s click wiring needed no change either: what changed
 * is only where the click's answer is written down.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Action, AttackDeclaration, Choice, Decision, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { validateAction } from '@mtg/kernel';
import { declarationWords } from './declare';
import type { Assignment, DeclarationPlan } from './declare';
import type { DeclarationConfirm } from './declare-panel';
import type { DeclarationControl } from './selection';

/**
 * The declare-attackers branch of the kernel's `Decision`, on its own.
 *
 * Narrowed once here rather than at every use, so `eligible` and `options` are
 * reachable without a second `kind` test and a reader can see that this file
 * only ever looks at one of the ten branches.
 */
type AttackerDecision = Extract<Decision, { kind: 'declareAttackers' }>;

/**
 * What this file needs of a session, which is three fields.
 *
 * Structural rather than `GameSession`, because the live view, the sealed game
 * and the remote seat hand down narrower session shapes and none of them is the
 * kernel's whole record. All three are read-only facts the caller already has.
 *
 * `state` is here for the declaration the enumeration did not list: a submitted
 * action is checked against the position rather than looked up in a list, so the
 * position has to be reachable from where the confirm is built.
 */
export interface StagingSession {
  readonly state: GameState;
  readonly pending: Decision | null;
  readonly decisions: number;
}

/**
 * The staging a surface that owns no session has: nothing is being declared and
 * nothing can be staged.
 *
 * A stated value rather than an optional prop with a default, for the reason
 * `Board`'s `prompt` and `rail` are stated: four measuring rigs and every
 * read-only render pass it, and a caller that forgot would otherwise get
 * whatever the default happened to be that week. The two setters throw nothing
 * and do nothing, because nothing may call them — `eligible` is empty, and every
 * caller gates on that.
 */
export const NO_STAGING: AttackStaging = {
  eligible: new Set<string>(),
  staged: new Set<string>(),
  toggle: (): void => undefined,
  stageAll: (): void => undefined,
  confirm: null,
};

/** What the confirm control offers, in the order it draws them. */
export interface AttackStaging {
  /** Object ids the kernel says may attack. Nothing outside this may be staged. */
  readonly eligible: ReadonlySet<string>;
  /** What the player has staged so far. */
  readonly staged: ReadonlySet<string>;
  /** Puts a creature in the combat band, or takes it back out. */
  readonly toggle: (key: string) => void;
  /** Stages every creature the kernel says may attack, and no others. */
  readonly stageAll: () => void;
  /**
   * What confirming submits, or `null` when the kernel is not asking this seat
   * for attackers at all.
   *
   * Null is about the decision rather than about the staged set: every subset of
   * `eligible` is declarable, so once the question is open there is always
   * something to submit — including the empty declaration, which is a real move
   * and not an absence. (`attackChoice` still asks the kernel, so a kernel that
   * refused one would also land here; that is a disagreement to be seen rather
   * than a state to design for.) One field rather than a "declaring" flag beside
   * a nullable index, because the two would be one fact spelled twice and the
   * second spelling is the one that goes stale.
   */
  readonly confirm: Choice | null;
}

function attackerSet(action: Action): ReadonlySet<string> | null {
  if (action.type !== 'declareAttackers') return null;
  return new Set(action.attackers.map((attack) => String(attack.oid)));
}

function sameSet(one: ReadonlySet<string>, two: ReadonlySet<string>): boolean {
  if (one.size !== two.size) return false;
  for (const member of one) if (!two.has(member)) return false;
  return true;
}

/**
 * What declares exactly this set of attackers: the enumeration's index where one
 * names it, the declaration itself where none does.
 *
 * The index is preferred and the action is the fallback, which is `session.ts`'s
 * own order and what keeps this invisible to every board under the cap: a game
 * of six creatures records the integers it always did. Set equality over the
 * enumeration is the whole of the matching rule — never a label parsed back into
 * a set, and never a neighboring index, which would attack with the wrong
 * creatures and look like it worked.
 *
 * `validateAction` is the guard on the constructed half rather than a trusted
 * caller, exactly as `declarationChoice` guards the block half. It cannot refuse
 * a set built out of `eligible`, and it is asked anyway: the alternative is this
 * surface asserting a rule the kernel owns, and the day a keyword makes an
 * attack mandatory the assertion would be silently wrong instead of loudly
 * absent.
 */
export function attackChoice(
  state: GameState,
  decision: AttackerDecision,
  staged: ReadonlySet<string>,
): Choice | null {
  // The board-band shortcut stages only a set of creatures. Once a walker adds
  // another defender, that set no longer identifies a declaration; the roster
  // owns the complete per-attacker defender choice instead.
  if (decision.defenders.length !== 1) return null;
  const defender = decision.defenders[0];
  if (defender === undefined) return null;
  // Narrowed to the kernel's own list before anything is looked up or built, so
  // a key naming nothing on the board cannot push a set that *is* enumerated
  // onto the constructed path and record an action where an integer would do.
  const attackers = decision.eligible.filter((oid) => staged.has(String(oid)));
  const wanted = new Set(attackers.map(String));
  const found = decision.options.findIndex((option) => {
    const set = attackerSet(option);
    return set !== null && sameSet(set, wanted);
  });
  if (found !== -1) return found;
  const action: Action = {
    type: 'declareAttackers',
    player: decision.player,
    attackers: attackers.map((oid): AttackDeclaration => ({ oid, defender })),
  };
  return validateAction(state, action) === null ? action : null;
}

/** Which seat the kernel is asking, when it is asking for attackers at all. */
function attackerDecisionOf(session: StagingSession, viewer: PlayerId): AttackerDecision | null {
  const pending = session.pending;
  if (pending === null || pending.kind !== 'declareAttackers') return null;
  return pending.player === viewer ? pending : null;
}

/**
 * The staged attack for one seat, read off the same `DeclarationControl` the
 * roster writes to (`mtg-5t05`).
 *
 * Holds no state of its own: `declaration` is `selection.ts`'s single record of
 * this decision, scoped to `session.decisions` there for the reason every staged
 * proposal on this surface is — a proposal outlives the question it answers by
 * exactly zero renders, and comparing a counter does that without React running
 * a cleanup, so a server-rendered table and a live one agree about what is on
 * screen. This function only translates: `Assignment`'s keys become the
 * `ReadonlySet<string>` this file's callers were built against, and a write goes
 * back through the control's own `press` and `setAssignment` rather than through
 * a second copy of the set.
 *
 * `declaration` is `null` at every decision that is not this one — `PlayView.ts`
 * passes `selection.declaration` straight through, and `selection.ts` already
 * returns `null` off the roster whenever the kernel is asking anything else. It
 * is also `null` where `declarationPlan` refuses a plan (an attack decision with
 * fewer than two options and nothing to build), which is a board with nothing to
 * stage regardless: `eligible` below is empty in exactly that case too, so no
 * caller of this file's `toggle` or `stageAll` can reach a `null` control through
 * a key `eligible` said was live.
 */
export function useAttackStaging(
  session: StagingSession,
  viewer: PlayerId,
  declaration: DeclarationControl | null,
): AttackStaging {
  const decision = attackerDecisionOf(session, viewer);
  const eligible = new Set<string>(
    decision === null || decision.defenders.length !== 1 ? [] : decision.eligible.map(String),
  );
  const live =
    decision === null || declaration === null || declaration.plan.kind !== 'declareAttackers'
      ? null
      : declaration;
  // A key that is no longer eligible is dropped rather than carried: the
  // enumeration is the authority on what may attack, and a stale key would make
  // `attackChoice` null for a set the player believes they staged.
  const staged = new Set<string>(
    live === null ? [] : [...live.assignment.keys()].map(String).filter((key) => eligible.has(key)),
  );

  return {
    eligible,
    staged,
    toggle: (key: string): void => {
      if (live === null || !eligible.has(key)) return;
      const subject = live.plan.subjects.find((one) => String(one.oid) === key);
      // Every subject here has exactly one candidate — its one defender, since
      // `eligible` above is empty whenever the decision has more than one — so
      // `rosterPress` (which `press` calls) always assigns outright and never
      // opens a question. That is what keeps a board click a plain toggle.
      if (subject !== undefined) live.press(subject, 'board');
    },
    stageAll: (): void => {
      if (live === null) return;
      const next = new Map<ObjectId, string>();
      for (const subject of live.plan.subjects) {
        const only = subject.candidates[0];
        if (only !== undefined) next.set(subject.oid, only.key);
      }
      live.setAssignment(next);
    },
    confirm: decision === null ? null : attackChoice(session.state, decision, staged),
  };
}

/** What the confirm says when nothing has been staged: a real declaration of none. */
export const NO_ATTACKS_LABEL = 'No attacks';

/**
 * The controls at the end of the combat band, which are the confirm boundary.
 *
 * They are in the band rather than in the ask column because the band is where
 * the attack is being built: a confirm you have to look somewhere else for is a
 * confirm that reads as unrelated to the thing it commits. The ask column is
 * unaffected and stays the complete enumeration — every subset the kernel offers
 * is still listed there, still by index, still reachable by keyboard, which is
 * `rail.ts`'s binding contract and what `test/play/play.test.ts` drives a whole
 * game through. Clicking creatures is the *additional* path `mtg-bz2.14` asks
 * for, never the replacement.
 *
 * "Attack with all" is only offered when it would say something the confirm does
 * not, and what it means is stated in its accessible name rather than assumed:
 * `eligible` is the kernel's own list of creatures that may attack, so a tapped
 * or summoning-sick creature is not in it and the button cannot stage one.
 *
 * The confirm is live for every staged set, including the ones past the 512-option
 * cap that it used to draw disabled (`mtg-dwd`). It submits a `Choice`, so a set
 * the enumeration carries goes over as its index and a set it does not goes over
 * as the declaration — never a neighboring index, which would attack with the
 * wrong creatures and look like it worked.
 */
export function attackControls(staging: AttackStaging, onChoose: (choice: Choice) => void): ReactNode {
  const confirm = staging.confirm;
  if (confirm === null) return null;
  const count = staging.staged.size;
  const buttons: ReactElement[] = [];
  const confirmLabel = count === 0 ? NO_ATTACKS_LABEL : `Attack with ${String(count)}`;
  buttons.push(
    createElement(
      'button',
      {
        key: 'confirm',
        type: 'button',
        className: 'mtg-combat__button',
        'data-kind': 'confirm',
        onClick: (): void => {
          onChoose(confirm);
        },
      },
      confirmLabel,
    ),
  );
  if (staging.eligible.size > 1 && count < staging.eligible.size) {
    buttons.push(
      createElement(
        'button',
        {
          key: 'all',
          type: 'button',
          className: 'mtg-combat__button',
          'data-kind': 'all',
          'aria-label': `Attack with all ${String(staging.eligible.size)} creatures that can attack`,
          onClick: (): void => {
            staging.stageAll();
          },
        },
        'Attack with all',
      ),
    );
  }
  return buttons;
}

/** What the band needs of a block being assembled; `selection.ts` owns the state. */
export interface BlockStaging {
  readonly plan: DeclarationPlan;
  readonly assignment: Assignment;
  /** What confirming submits, or null when the rules refuse this assignment. */
  readonly confirm: DeclarationConfirm | null;
  /** Drops every assignment without touching the kernel. */
  readonly clear: () => void;
}

/**
 * Why a half-built block cannot be confirmed, in the words the panel already
 * uses for it.
 *
 * One sentence rather than two, because there is one way to reach the state and
 * a surface that guessed at a second reason would be inventing one. Menace (CR
 * 702.110b) is it: a lone blocker on a menacing attacker is a declaration the
 * player is halfway through building, so the confirm is refused and every
 * creature stays pressable.
 */
export const NO_BLOCK_CONFIRM_REASON = 'The rules do not allow this assignment yet.';

/** What the Clear in the band is called, for a player who never opens the rail. */
export const CLEAR_BLOCKS_LABEL = 'Clear the blocks';

/**
 * The confirm boundary for a block, at the end of the band where the attack's is.
 *
 * This is the half of the playtester's complaint the gesture on its own does not
 * answer. Attacking ends at a button in the band, two inches under the creature
 * that was just staged; blocking ended at a button in a 148px side column, which
 * is a second place to look at the moment the player has just finished looking
 * at the cards. The rail keeps its own confirm — it is the complete enumeration
 * and the keyboard path, and `rail.ts` holds that contract — so this is a second
 * door to one `Choice`, exactly as the stack's resolve press is a second door to
 * the pass.
 *
 * A refused assignment leaves the button disabled with the reason on it rather
 * than absent, which is the opposite of what the panel does and right for the
 * opposite reason: the panel replaces it with a sentence a reader will meet on
 * the way down the column, and a control that vanished from a bar you are
 * looking at reads as the surface having lost the declaration.
 */
export function blockControls(staging: BlockStaging | null, onChoose: (choice: Choice) => void): ReactNode {
  if (staging === null || staging.plan.kind !== 'declareBlockers') return null;
  const count = staging.assignment.size;
  const confirm = staging.confirm;
  const buttons: ReactElement[] = [
    createElement(
      'button',
      {
        key: 'confirm',
        type: 'button',
        className: 'mtg-combat__button',
        'data-kind': 'confirm',
        disabled: confirm === null,
        // The enumerated declaration's own sentence, so the button a player
        // commits at announces the same words the flat list printed on it.
        ...(confirm === null ? { title: NO_BLOCK_CONFIRM_REASON } : { 'aria-label': confirm.name }),
        onClick: (): void => {
          if (confirm !== null) onChoose(confirm.choice);
        },
      },
      declarationWords('declareBlockers').confirm(count),
    ),
  ];
  if (count > 0) {
    buttons.push(
      createElement(
        'button',
        {
          key: 'clear',
          type: 'button',
          className: 'mtg-combat__button',
          'data-kind': 'clear',
          onClick: staging.clear,
        },
        CLEAR_BLOCKS_LABEL,
      ),
    );
  }
  return buttons;
}
