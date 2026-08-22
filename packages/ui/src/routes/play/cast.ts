/**
 * A cast in progress: what is still to be chosen, and what it will cost.
 *
 * # Why a cast is staged and a rail press is not
 *
 * The rail lists finished moves. `Cast Lightning Lash → Windrider Drake` names
 * the spell and its aim in one line, so pressing it commits to something the
 * button already said. That path is untouched by this module and stays the
 * complete enumeration (`rail.ts` holds that contract).
 *
 * Clicking the card is the other path, and it is the one `mtg-bz2.3` is about.
 * A card click used to open a menu of every aiming at once and submit whichever
 * was pressed, so the two things a player wants to know before committing —
 * where the spell is pointed and which lands it will turn sideways — were
 * either crammed into one button label or not on screen at all. This module
 * walks them one at a time, and nothing reaches the kernel until the last press.
 *
 * # The stages are the rules' own order
 *
 * CR 601.2b announces the modes. CR 601.2c chooses targets. CR 601.2h pays the
 * costs. They are separate steps of one rule and they happen in that order,
 * which matters here for a reason that outlives this implementation: a surface
 * that let you pay before you knew what you were aiming at would be a surface
 * that occasionally charged you for a spell you then wanted to point somewhere
 * else, and a surface that asked for a target before the mode would be asking
 * about an effect list the spell may not end up having. `castStage` can only
 * reach the payment stage with the mode and every target slot settled, so the
 * order is structural rather than a convention the panel happens to follow.
 *
 * **Two of the stages on the playtester's list are here now and two still have no
 * word in the card vocabulary.** Modes arrived (`mtg-bc2.152.5` put `modes` on
 * the card, `.152.4` threaded the chosen one through casting), so a modal card
 * prints an empty `effects` and keeps what it does in `card.modes`, the kernel
 * enumerates one cast per mode, and `castSpell` carries the `mode` that was
 * announced — a panel that did not ask would be announcing one on the player's
 * behalf. X arrived too, as `manaCost.hasX` and the action's `x`, and it is
 * deliberately *not* a stage: everything this panel says about payment is
 * settled once per card, and a cost with an X in it is not settled until the
 * value is announced. Such a card is refused a staged cast outright (see
 * `castPlansFor`) and read as the flat menu instead, where `prompt.ts` gives
 * every announced value a line of its own. Alternative and additional costs
 * (CR 601.2f) have no word in `@mtg/dsl` at all and so no stage to build.
 *
 * `CAST_CHOICE_STAGES` is that paragraph as a total mapped type over the cast
 * action's own choices, so a fourth thing a cast announces cannot be added to
 * the kernel without this file failing to compile, and `test/play/cast.test.ts`
 * checks the property it produces rather than its contents: every stage it
 * names is a stage the panel reaches, and every cast the kernel enumerated is
 * reachable by answering the questions it asks.
 *
 * # Nothing here re-derives legality
 *
 * Every option a stage offers came out of `Decision.options`. The candidates for
 * a target slot are the distinct targets the kernel's own enumeration put in
 * that slot, narrowed by the choices already made, and the finished cast is the
 * single enumerated option those choices leave standing — so what the panel
 * submits is an index, exactly as a rail press is, and a game played through it
 * replays like any other. It is the enumeration read one slot at a time rather
 * than a second opinion about what may be cast at what.
 *
 * The payment is the kernel's too. `planPayment` is the same function
 * `onCastSpell` calls when the cast is reduced, given the same state, and the
 * plan is deterministic — so the lands named on the panel are the lands that end
 * up tapped, rather than a guess that happens to agree most of the time. Same
 * state includes the fourth argument: the planner spends the lands the rest of
 * the hand needs least, and a panel that failed to name the card being cast
 * would count that card's own pips as a reason to save a land the reducer
 * spends.
 */
import { effectsFor, renderEffect } from '@mtg/dsl';
import type { ManaCost } from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId, Target } from '@mtg/kernel';
import { planPayment, tryObject } from '@mtg/kernel';
import { describeTarget, nameOf } from './position';
import type { SeatNames } from './position';

/** The one action this whole flow is assembling, named so its keys can be read. */
type CastAction = Extract<Action, { readonly type: 'castSpell' }>;

/**
 * Everything a `castSpell` announces that the player chose, as opposed to the
 * three fields that say which cast it is (`type`, `player`, `oid`).
 */
type CastChoice = Exclude<keyof CastAction, 'type' | 'player' | 'oid'>;

/**
 * Which stage asks each choice a cast announces, or `null` for the one this
 * panel refuses to stage at all.
 *
 * Total over `CastChoice` on purpose, and that is the whole of its job: it is
 * unread at runtime by anything but its own test, and it exists so that a
 * choice added to `castSpell` in `@mtg/kernel` cannot reach a player through
 * this surface without somebody deciding here which question asks it. The
 * header's paragraph is the argument; this is the part a compiler checks.
 */
export const CAST_CHOICE_STAGES: { readonly [K in CastChoice]: CastStep | null } = {
  targets: 'targets',
  mode: 'mode',
  // No stage, and no staged cast either — `castPlansFor` refuses a cost with
  // an X in it, so the enumeration is read as the flat menu, where every
  // announced value is its own line. A stage here would have to re-plan the
  // payment per announced value, and `CastPlan.taps` is one plan per card.
  x: null,
  // No stage either, for `mtg-kg44`'s `TargetSpec.count` slot ("up to two
  // target creatures"). `answers` below narrows an enumerated cast by
  // `targets` and `mode` alone; a card with a counted slot enumerates several
  // casts that agree on both and differ only in `multiTargets`, which this
  // matcher does not read, so staging one would let the panel commit to
  // whichever enumerated option happened to match first rather than the one
  // the player meant. `castPlansFor` refuses the whole card the same way it
  // refuses an X cost, and the flat menu selects the exact enumerated action
  // by index instead, where there is no matcher to fool.
  multiTargets: null,
};

/**
 * One enumerated cast of one card: which mode it announces, how it aims, what
 * it will read as, and where it sits in the list.
 *
 * The printed sentences belong here rather than to the plan because a modal
 * card's two options are two different spells — different sentences, and a
 * different number of target slots to put them beside. A plan-level list could
 * only be the card's own `effects`, which a modal card leaves empty (CR 700.2;
 * `@mtg/dsl`'s `modal.ts`), so the panel would draw a spell that does nothing
 * whichever mode the player was choosing. The payment stays on the plan for the
 * mirror-image reason: a mode changes what a spell does and never what it
 * costs, so one `planPayment` per card is one plan per cast.
 */
export interface CastOption {
  /** Index into `decision.options`. The only thing this flow ever submits. */
  readonly index: number;
  /** CR 700.2's announced mode, by index into `card.modes`; `null` on a card with none. */
  readonly mode: number | null;
  /** Parallel to `effects`; `null` where an effect needs no target. */
  readonly targets: readonly (Target | null)[];
  /** One printed sentence per effect of the list this option casts. */
  readonly effects: readonly string[];
}

/** One land the payment will tap, named as it is drawn on the table. */
export interface CastTap {
  readonly oid: ObjectId;
  readonly name: string;
}

/** Everything a staged cast of one card needs, derived once per decision. */
export interface CastPlan {
  readonly oid: ObjectId;
  readonly cardName: string;
  /** The cost as the card prints it, so the panel draws the same pips the face does. */
  readonly manaCost: ManaCost;
  /** Every enumerated cast of this card, in enumeration order. */
  readonly options: readonly CastOption[];
  /** The lands `onCastSpell` will tap, in the order it taps them. */
  readonly taps: readonly CastTap[];
}

/**
 * One question this cast has already been answered: a mode, or a target slot.
 *
 * Held as a list in the order the questions were answered rather than as an
 * array indexed by slot, which is what makes backing up a matter of dropping the
 * last entry. Settled questions — the ones with a single answer, which are never
 * asked — are not in the list, so a step back always lands on a real question.
 *
 * A discriminated union rather than a slot number a mode could borrow: a mode is
 * not a slot, and narrowing on it compares a different field of the enumerated
 * cast. Spelling both as `{ slot, target }` would make `narrow` guess which of
 * the two a pick meant from the value in it.
 */
export type CastPick =
  | { readonly kind: 'mode'; readonly mode: number }
  | { readonly kind: 'target'; readonly slot: number; readonly target: Target | null };

/** One thing a target slot may be aimed at, as a button reads it. */
export interface CastCandidate {
  readonly target: Target | null;
  readonly label: string;
}

/** One mode a modal spell may be cast in, as a button reads it. */
export interface CastModeChoice {
  /** Index into `card.modes`, which is what the action announces. */
  readonly mode: number;
  /** The mode's own printed sentences, which is how a card prints its bullets. */
  readonly label: string;
}

/**
 * The three questions a cast can be asked, in the order CR 601.2 asks them.
 *
 * A stage's `kind` is one of these and so is every entry in `steps`, which is
 * what lets the panel name a step it is not currently on. `cast-panel.ts` maps
 * them to the words on screen; nothing here decides what a step is called.
 */
export type CastStep = 'mode' | 'targets' | 'pay';

/**
 * One slot waiting for an aim, named rather than left inline in the union below.
 *
 * It has a name because a second surface reads it: `targeting.ts` turns the same
 * candidate list into what the battlefield lights (`mtg-bz2.6`), and a panel and
 * a board that derived their answers from two different shapes could disagree
 * about what is a legal target. Naming the member is the whole of that change —
 * nothing about the stage moved.
 */
export interface CastTargetStage {
  readonly kind: 'targets';
  /** Every stage this cast walks, in order; see `CastStep`. */
  readonly steps: readonly CastStep[];
  /** Index into the enumerated cast's `targets`, which is the slot being filled. */
  readonly slot: number;
  /** The printed sentence being aimed, so the button says what it does. */
  readonly ask: string;
  readonly candidates: readonly CastCandidate[];
}

/**
 * CR 601.2b's announcement, asked first because everything after it depends on
 * the answer — a mode decides the sentences, and with them how many target
 * slots there are to fill.
 */
export interface CastModeStage {
  readonly kind: 'mode';
  readonly steps: readonly CastStep[];
  /** The card's own "Choose one" line, so the panel asks what the card asks. */
  readonly ask: string;
  readonly choices: readonly CastModeChoice[];
}

export type CastStage =
  | CastModeStage
  | CastTargetStage
  | {
      readonly kind: 'pay';
      readonly steps: readonly CastStep[];
      /** The one enumerated cast the choices so far leave standing. */
      readonly option: CastOption;
      /** One line per aimed slot: what the effect does, and what it is aimed at. */
      readonly aims: readonly string[];
    };

/**
 * CR 700.2's own words for the question the mode stage asks.
 *
 * The same line `@mtg/dsl`'s `renderModesBlock` prints above a card's bullets,
 * spelled again here because that function is private to the oracle renderer
 * and what it returns is the whole block rather than its first line. The two
 * agree that a modal spell chooses exactly one: `effectsFor` and the action's
 * `mode` both take a single index, so "choose two" is a widening of the
 * mechanism before it is ever a word on this panel.
 */
const MODE_ASK = 'Choose one —';

/**
 * A target's identity as a string, so two spellings of one aim compare equal.
 *
 * Local rather than borrowed from `@mtg/kernel`'s `actionKey`: that one compares
 * whole actions, and what this needs is one slot of one action. The three target
 * shapes are closed (`state.ts`'s `Target`), so the mapping is total and the
 * `null` slot — an effect that needs no target — gets a name of its own rather
 * than colliding with a permanent whose id happens to be empty.
 */
function targetKey(target: Target | null): string {
  if (target === null) return 'none';
  return target.kind === 'player' ? `player:${String(target.player)}` : `${target.kind}:${target.oid}`;
}

/**
 * The staged cast available for each card in hand, keyed by object id.
 *
 * Built from `Decision.options` rather than from `prompt.ts`'s labeled choices,
 * because a `PlayChoice` carries the objects a move acts on and not the aim in
 * each slot, and the aim per slot is the whole of what this flow walks.
 *
 * An object with a cast here has no other move on offer, which is why nothing
 * below checks for one: a cast names a nonland card in hand, and the only other
 * action that names a hand card at a priority is `playLand`, which names a land.
 *
 * A card whose cost the kernel will not plan a payment for gets no plan at all
 * and falls back to the picker, which submits an enumerated index directly. That
 * is unreachable today — `castOptions` enumerates a cast only when `canPay` says
 * yes, and `canPay` *is* `planPayment` returning something — and it is a
 * degradation rather than invented copy if the two ever disagree: the move stays
 * playable, without the payment line.
 *
 * **A cost with an X in it takes that same road deliberately.** `planPayment`
 * answers for the cost it is handed, and `manaCost` with `hasX` set is not the
 * cost of any particular cast — the kernel enumerates one cast per announced
 * value and only then knows what is owed. A plan built here would name the lands
 * X=0 taps and then be shown beside every other X, so the card is left to the
 * flat menu, where `prompt.ts` prints the announced value in each line. That is
 * the honest reading of `CAST_CHOICE_STAGES`'s one `null` row.
 */
export function castPlansFor(state: GameState, decision: Decision): ReadonlyMap<ObjectId, CastPlan> {
  const byObject = new Map<ObjectId, EnumeratedCast[]>();
  for (const [index, action] of decision.options.entries()) {
    if (action.type !== 'castSpell') continue;
    const entry: EnumeratedCast = { index, action };
    const held = byObject.get(action.oid);
    if (held === undefined) byObject.set(action.oid, [entry]);
    else held.push(entry);
  }

  const plans = new Map<ObjectId, CastPlan>();
  for (const [oid, enumerated] of byObject) {
    const object = tryObject(state, oid);
    if (object === undefined) continue;
    const card = object.card;
    if (card.kind === 'land') continue;
    if (card.manaCost.hasX) continue;
    // `mtg-kg44`'s counted slot: see `CAST_CHOICE_STAGES.multiTargets`'s
    // comment for why this card is left to the flat menu instead of staged.
    if (enumerated.some(({ action }) => action.multiTargets !== undefined)) continue;
    const payment = planPayment(state, decision.player, card.manaCost, oid);
    if (payment === null) continue;
    plans.set(oid, {
      oid,
      cardName: card.name,
      manaCost: card.manaCost,
      options: enumerated.map(({ index, action }): CastOption => {
        const mode = action.mode ?? null;
        return {
          index,
          mode,
          targets: action.targets,
          // Rendered per option rather than once per card, which costs a
          // non-modal card the same sentences several times over and is what
          // makes a modal card's two options readable at all. `effectsFor` is
          // the kernel's own resolution of which list this cast casts, so the
          // sentences beside a slot are the sentences that will resolve.
          //
          // `renderEffect` rather than `renderEffectList`: the list renderer
          // threads back-references between sentences ("that player"), and each
          // of these is read alone as the label of one target slot, where a
          // pronoun has no antecedent on screen.
          effects: effectsFor(card, mode).map((effect) => renderEffect(effect, card.name)),
        };
      }),
      taps: payment.taps.map((tapped): CastTap => ({ oid: tapped, name: nameOf(state, tapped) })),
    });
  }
  return plans;
}

/** An enumerated cast before the card it names has been looked up. */
interface EnumeratedCast {
  readonly index: number;
  readonly action: CastAction;
}

/** Whether one enumerated cast is still consistent with one answer. */
function answers(option: CastOption, pick: CastPick): boolean {
  if (pick.kind === 'mode') return option.mode === pick.mode;
  return targetKey(option.targets[pick.slot] ?? null) === targetKey(pick.target);
}

/** The enumerated casts still consistent with every choice made so far. */
function narrow(plan: CastPlan, picks: readonly CastPick[]): readonly CastOption[] {
  return plan.options.filter((option) => picks.every((pick) => answers(option, pick)));
}

/**
 * The stages this cast has, read off the casts still live.
 *
 * A stage this cast *has* rather than a question the player will be asked: a
 * spell with exactly one legal aim lists its target stage and then settles it
 * unasked, which is the behavior the strip has always had, and a mode with one
 * legal cast behaves the same way. What is listed is what the announcement
 * consists of, so answering a question never removes the step that asked it and
 * Back always has somewhere to go.
 *
 * The target step can still narrow away, and that is the truth rather than a
 * limitation: whether a cast aims at anything is something CR 601.2b's mode
 * decides, so a strip that kept promising a target question after a
 * targetless mode was announced would be promising on behalf of the mode
 * nobody chose.
 */
function stepsFor(live: readonly CastOption[]): readonly CastStep[] {
  const steps: CastStep[] = [];
  if (live.some((option) => option.mode !== null)) steps.push('mode');
  if (live.some((option) => option.targets.some((target) => target !== null))) steps.push('targets');
  steps.push('pay');
  return steps;
}

/**
 * What the panel asks next, or `null` when the picks name no enumerated cast.
 *
 * Null is the staleness guard, and it is the same one the picker carries: a
 * staged cast is scoped to `session.decisions`, which is a counter rather than
 * an identity, so two different positions can arrive at one count (`selection.ts`
 * lists the three ways). Picks taken against one position can then name a tuple
 * the other position never enumerated, and the honest answer is to close the
 * panel rather than to draw a stage over an empty option list.
 *
 * **A question with one answer is settled rather than asked**, and that is not
 * the surface inferring intent — a slot the kernel enumerated one aim for, or a
 * modal card whose other modes have no legal cast in this position, leave
 * nothing to decide. The whole aim is printed on the payment stage before
 * anything is committed, so a spell that had exactly one legal target still says
 * so before the player pays for it.
 */
export function castStage(
  state: GameState,
  names: SeatNames,
  plan: CastPlan,
  picks: readonly CastPick[],
): CastStage | null {
  const live = narrow(plan, picks);
  const settled = live[0];
  if (settled === undefined) return null;
  const steps = stepsFor(live);

  // CR 601.2b before CR 601.2c: the mode decides which effect list this cast
  // casts, and the slots below are that list's. Asking in the other order would
  // be aiming sentences the spell may not end up printing.
  const modes = new Map<number, string>();
  for (const option of live) {
    if (option.mode !== null && !modes.has(option.mode)) modes.set(option.mode, option.effects.join(' '));
  }
  if (modes.size > 1) {
    return {
      kind: 'mode',
      steps,
      ask: MODE_ASK,
      choices: [...modes].map(([mode, label]): CastModeChoice => ({ mode, label })),
    };
  }

  // The slots are the enumerated cast's own target slots rather than the
  // sentence count: an Aura prints no effect and is aimed all the same
  // (`castOptions` reads `card.aura.enchant` for it), so a walk over the
  // sentences would leave that aim to be picked rather than asked. Every live
  // option shares one mode by now, so `settled` speaks for all of them.
  const decided = new Set(picks.flatMap((pick) => (pick.kind === 'target' ? [pick.slot] : [])));
  for (let slot = 0; slot < settled.targets.length; slot += 1) {
    if (decided.has(slot)) continue;
    const candidates = new Map<string, Target | null>();
    for (const option of live) {
      const target = option.targets[slot] ?? null;
      candidates.set(targetKey(target), target);
    }
    if (candidates.size < 2) continue;
    return {
      kind: 'targets',
      steps,
      slot,
      ask: settled.effects[slot] ?? plan.cardName,
      candidates: [...candidates.values()].map((target): CastCandidate => ({
        target,
        label: target === null ? 'No target' : describeTarget(state, names, target),
      })),
    };
  }

  const aims: string[] = [];
  for (const [slot, target] of settled.targets.entries()) {
    if (target === null) continue;
    const effect = settled.effects[slot] ?? plan.cardName;
    aims.push(`${effect} → ${describeTarget(state, names, target)}`);
  }
  return { kind: 'pay', steps, option: settled, aims };
}
