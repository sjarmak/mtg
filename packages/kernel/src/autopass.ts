/**
 * Which priorities are worth asking about.
 *
 * A seeded game asks a human for a decision at every priority in every step of
 * both turns, and the answer is `Pass` almost every time: driving one to turn 24
 * took 252 clicks. Arena and Magic Online both solved this and both solved it
 * the same way — auto-pass, a set of steps that always stop, a full-control
 * escape hatch, and a yield that runs to a named boundary — so this module
 * adopts that shape rather than inventing one.
 *
 * **Nothing here is game state.** A stop set is a fact about what to *ask*, not
 * about the position, so it travels in `SessionOptions` and never in
 * `GameState`. Putting it in `TurnState` would drag a display preference into
 * `stateFingerprint`, into `fork`, and into replay determinism, and two people
 * with different stops would be playing two different games.
 *
 * **Two mechanisms pass priorities here, and the difference between them is the
 * whole design.**
 *
 * The first is structural. `settledChoice` fires only where the kernel
 * enumerated exactly one legal option, so the position it takes had one
 * continuation whichever way the question was answered. Taking it is therefore
 * not a decision, and the recording proves it: `session.ts` puts the same action
 * through the same `reduce` and appends the same index to `choices`, so a game
 * played with it on and the same game played with it off record byte-identical
 * event and choice logs. It is the one of the two that is not about priority at
 * all — a blocker declaration with one legal answer is settled the same way
 * (`mtg-y1t.3`).
 *
 * The second is the stop set, and it *is* a decision. `passUnstopped` makes the
 * set authoritative the way Magic Online and Arena do: a priority no stop names
 * is passed even with ten legal plays in it, because the player said they did
 * not want to be asked there. That can never be log-invisible — a pass and a
 * cast are different games — so it keeps the weaker invariant that is still
 * exact. The pass is written into `choices` as the pass it is, and a replay at
 * full control spends those integers and reproduces the game byte for byte.
 *
 * They stay apart rather than folding into one predicate, and not for
 * tidiness: folded, the structural rule would be dead code, since every
 * priority it fires at is one an unstopped step already covers. Apart, it is
 * what a player who wants every legal play offered still gets, and it is the
 * mechanism the byte-identity test can be written against at all.
 *
 * One rule outranks both and is not a setting: a player is never passed out of a
 * window over a spell on the stack they could have answered. `canRespond` is
 * what counts as an answer, and why tapping a land is not one.
 *
 * **`canRespond` gates the asking side too, and that is `mtg-hmy`.** A stop says
 * where to offer the player their plays; where the kernel enumerated none, there
 * is nothing to offer and the stop has nothing to say. `stopWantsAQuestion` is
 * that qualification, and the argument for making it a rule rather than a
 * setting is on it.
 *
 * **Both stacks count, and the second half is `mtg-bz2.4`.** Your own spell on
 * top of the stack is the window CR 117.3c hands you after you cast, and it is
 * covered by the same rule the other seat's spell is. `stackWantsAnAnswer` is
 * the whole of it and argues why it is a rule rather than the toggle Magic
 * Online spends a control on.
 *
 * Neither is a judgment, which is what keeps both inside the ZFC line. Arena
 * auto-passes some priorities where a legal play exists on a guess about what
 * you meant — it will pass a window whose only castable card is a sorcery you
 * cannot cast right now — and that is the application layer deciding an
 * enumerated action is not worth offering. `options.length === 1` is a
 * structural fact about what the kernel already enumerated, and a stop set is a
 * sentence the player typed in: no scoring, no threshold, no keyword in either.
 */
import type { Decision } from './legal';
import type { ObjectId, PlayerId } from './ids';
import type { GameState, Step } from './state';
import { STEPS } from './state';

/**
 * Whose turn a stop applies to, relative to the player being asked.
 *
 * Relative rather than by seat, because the same setting has to serve both sides
 * of a hotseat game and because "stop in my second main phase" is a sentence
 * about the turn cycle, not about seat 0.
 */
export type TurnSide = 'yourTurn' | 'theirTurn';

export interface StopSet {
  /** Steps of the asked player's own turn that always stop and ask. */
  readonly yourTurn: ReadonlySet<Step>;
  /** Steps of the opponent's turn that always stop and ask. */
  readonly theirTurn: ReadonlySet<Step>;
}

export interface AutoPassSettings {
  /** False is full control: every priority is asked about, stops or no stops. */
  readonly enabled: boolean;
  /**
   * True makes the stop set authoritative: a priority no stop names is passed,
   * however many legal plays it holds. False leaves only the structural rule,
   * which passes a priority the kernel enumerated one option for and asks about
   * every other one — the conservative mode, and the one whose recordings are
   * identical to a full-control player's.
   *
   * Ignored while `enabled` is false, the way the stops themselves are: full
   * control asks about everything, and both preferences survive it so switching
   * back returns the interface the player had.
   */
  readonly passUnstopped: boolean;
  readonly stops: StopSet;
}

/** How far a yield runs before it hands the game back. */
export type YieldBoundary = 'endOfTurn' | 'yourNextTurn';

/**
 * The steps a stop can be set on: every step `enterStep` ever grants priority
 * in.
 *
 * Untap and cleanup are the two it never does — `turn.ts` leaves priority `null`
 * there so the settle loop can move the game on by itself — so a stop on either
 * would be a control that does nothing whichever way it is set. Offering it is
 * worse than omitting it: a player who ticks it and still gets passed through
 * has been told the settings do not work.
 *
 * Derived from `STEPS` by subtraction rather than listed out, so a step added to
 * the turn structure tomorrow is stoppable without anyone remembering to come
 * back here. `test/autopass.test.ts` checks the subtraction against a real game:
 * no priority decision in a full seeded game arises at a step outside this list.
 */
export const STOPPABLE_STEPS: readonly Step[] = STEPS.filter(
  (step) => step !== 'untap' && step !== 'cleanup',
);

/**
 * What a player who has configured nothing gets.
 *
 * The defaults are a design call, and this is the reasoning. With the set
 * authoritative a stop is the difference between being offered a play and
 * passing it by, so the default has to cover both jobs at once: the windows
 * where the position changes under you, and the windows you would want to act
 * in.
 *
 * On the opponent's turn: `declareAttackers` and `declareBlockers`, which is
 * where combat is settled and where a player with no trick still needs to see
 * what is coming and what it ran into; and `end`, the last window before
 * anything held back is wasted. Those are the three Magic Online's own default
 * stop set keys on, for the same reason.
 *
 * On your own turn: both main phases. That is where a turn is spent, and it is
 * also the one place a pass could silently spend a whole turn — an empty hand or
 * a missing land means nothing to do in every window, so without these two stops
 * a turn you could do nothing in would flash past with no beat in it at all. Two
 * clicks a turn is the price of always seeing your own turn happen.
 *
 * Not defaulted: everything in the beginning phase, the combat steps either side
 * of the declarations, and the opponent's main phases. The opposing-stack rule
 * below still hands the game back in them whenever the other seat casts
 * something this player could answer, so what is given up is narrower than it
 * looks: not the chance to respond, which arrives on its own, but the chance to
 * act first. Holding an instant to cast *before* the opponent does anything, in
 * your own combat or their upkeep, wants a tick in that box or a press of full
 * control. Every surface that ships stops makes a player do that.
 */
export const DEFAULT_STOPS: StopSet = {
  yourTurn: new Set<Step>(['precombatMain', 'postcombatMain']),
  theirTurn: new Set<Step>(['declareAttackers', 'declareBlockers', 'end']),
};

export const DEFAULT_AUTO_PASS: AutoPassSettings = {
  enabled: true,
  passUnstopped: true,
  stops: DEFAULT_STOPS,
};

/** Full control: ask about every priority, the way the surface behaved before. */
export const FULL_CONTROL: AutoPassSettings = {
  enabled: false,
  passUnstopped: true,
  stops: DEFAULT_STOPS,
};

/** Which half of a stop set applies to a player right now. */
export function sideFor(state: GameState, player: PlayerId): TurnSide {
  return state.turn.active === player ? 'yourTurn' : 'theirTurn';
}

export function hasStop(stops: StopSet, side: TurnSide, step: Step): boolean {
  return stops[side].has(step);
}

/** True when the current step is one the player asked to always be stopped in. */
export function isStopped(state: GameState, player: PlayerId, stops: StopSet): boolean {
  return hasStop(stops, sideFor(state, player), state.turn.step);
}

/** Adds or removes one stop, returning new settings; the input is untouched. */
export function toggleStop(settings: AutoPassSettings, side: TurnSide, step: Step): AutoPassSettings {
  const next = new Set(settings.stops[side]);
  if (next.has(step)) next.delete(step);
  else next.add(step);
  return { ...settings, stops: { ...settings.stops, [side]: next } };
}

/** Turns full control on or off without disturbing the stops behind it. */
export function withFullControl(settings: AutoPassSettings, fullControl: boolean): AutoPassSettings {
  return { ...settings, enabled: !fullControl };
}

/** Makes the stop set authoritative, or hands the steps outside it back. */
export function withPassUnstopped(settings: AutoPassSettings, passUnstopped: boolean): AutoPassSettings {
  return { ...settings, passUnstopped };
}

/**
 * The stack objects this player did not put there.
 *
 * Returned as the set of ids rather than as a yes/no, because a yield needs the
 * harder question: not "is something of theirs on the stack" but "did something
 * of theirs *arrive* since I started yielding". A yield pressed while an
 * opposing spell is already resolving was pressed knowing that, and breaking it
 * on the spot would make the control useless exactly when it is most wanted.
 */
export function opposingStack(state: GameState, player: PlayerId): ReadonlySet<ObjectId> {
  const theirs = new Set<ObjectId>();
  for (const entry of state.stack) {
    if (entry.controller !== player) theirs.add(entry.oid);
  }
  return theirs;
}

/**
 * True when the player being asked controls the top object of the stack.
 *
 * CR 117.3c's retained priority, stated as a position rather than as a history:
 * a player who casts a spell or activates an ability keeps priority, and the
 * thing they just put there is on top. That is the whole of what "hold priority"
 * is held *over* — the window in which you can answer your own spell, which
 * `stackWantsAnAnswer` below refuses to auto-pass out of and which the play
 * surface names out loud (`@mtg/ui`'s `routes/play/priority.ts`).
 *
 * Read off the stack rather than off the last action for two reasons. The
 * position is what a replay reconstructs, so a rule written against it needs no
 * extra recording; and the same window is reached without a cast at all — the
 * top of the stack is still yours after the opponent's answer to it resolved,
 * and it is still the window you wanted to be asked in.
 *
 * Not a judgment and not a threshold: it is one comparison against a controller
 * the kernel already wrote down, which is what keeps it on the same side of the
 * ZFC line as `canRespond` and `isStopped`.
 */
export function holdsOwnTopOfStack(state: GameState, decision: Decision): boolean {
  if (decision.kind !== 'priority') return false;
  const top = state.stack[state.stack.length - 1];
  return top !== undefined && top.controller === decision.player;
}

/**
 * True when the kernel offered this player something to answer with.
 *
 * "Something" is every enumerated option except the pass itself and the mana
 * abilities, and leaving the mana abilities out is a structural fact rather than
 * a guess about what a player wants. Two things make it one.
 *
 * CR 605.1: a mana ability does not use the stack and cannot be responded to.
 * `actions.ts` models that by giving it its own action type, `activateManaAbility`,
 * deliberately a sibling of `activateAbility` rather than a case of it — so this
 * is a test on the type the kernel already assigned, not a reading of what a
 * card does.
 *
 * And tapping first can rarely reveal a play. `planPayment` pays every cost from
 * the pool *plus what the untapped sources promise* — `mana.ts`'s `tapPromise`,
 * which since `mtg-nhyv.27` covers a Llanowar Elf and a Gilded Lotus as well as
 * a land — so a spell that would be castable after tapping any of those is
 * already enumerated as a cast right now. Tapping ahead of a pass then only
 * takes options away: a pool of the wrong color empties at end of step and the
 * source stays tapped for the rest of the turn.
 *
 * Rarely, not never, and the gap has a name. The sources `tapPromise` refuses —
 * an amount the board decides, a cost that is more than the tap — are enumerated
 * here as `activateManaAbility` and are invisible to `planPayment`, so a
 * priority whose only offers are a Cabal Coffers activation and a pass is passed
 * even though activating it could pay for something. That is the pre-existing
 * half of this rule, narrowed by `mtg-nhyv.27` rather than introduced by it.
 */
export function canRespond(decision: Decision): boolean {
  return decision.options.some(
    (option) => option.type !== 'passPriority' && option.type !== 'activateManaAbility',
  );
}

/**
 * True when a stop names this step **and the kernel enumerated something to ask
 * about**.
 *
 * `mtg-hmy`, in the playtester's words: "I want an option to not have to 'let it
 * resolve' when I have no other actions that I can do that would not let it
 * resolve, e.g. when I tap out for a creature." The stop set was the mechanism
 * doing it to her. Measured over five seeded games driven by a player who holds
 * their instants, the default stops produced 121 priority prompts out of 233
 * whose entire content was the pass, or the pass and tapping a land — 52% of
 * every question the game asked, and every one of them at a step in
 * `DEFAULT_STOPS`. A friction audit playing in a real browser counted the same
 * thing from the other side: 70 of the 119 priority prompts in its six recorded
 * traces, including a stop at the opponent's declare-attackers on turns where
 * neither side controlled a creature.
 *
 * **It is a rule and not the setting she asked for.** A stop is how a player
 * says "offer me my plays here"; a priority the player cannot act at has no
 * plays to offer, so a prompt there is not a decision being put to them, it is a
 * page they have to dismiss. A control whose only honest default is on is a
 * default that was wrong, and this module has the precedent: `mtg-bz2.4` built
 * the hold-priority toggle, measured it over twenty seeded games, and threw it
 * away for a rule on the argument that a switch a player can leave off is a
 * switch that is off when it matters.
 *
 * **What that gives up.** A stop can no longer be used as a "pause here and
 * look" marker at a step the player can never act in — ticking `combatDamage`
 * with an empty hand now buys nothing. That want is real and it is `mtg-0sn`
 * (combat resolves in one click, with no chance to see what happened), and a
 * modal whose only button is Pass is the wrong instrument for it: it covers the
 * board the player is trying to watch. Full control is untouched and still
 * asks about every priority, because `settings.enabled` gates this whole module.
 *
 * A stop that still has something to offer still fires, which is the half that
 * does not move: this subtracts questions the player could not have answered and
 * no others.
 */
export function stopWantsAQuestion(state: GameState, decision: Decision, stops: StopSet): boolean {
  return isStopped(state, decision.player, stops) && canRespond(decision);
}

/**
 * The rule that no setting switches off: a player is never passed out of a
 * window over a spell on the stack **they could have answered**.
 *
 * The qualification is the whole of it. What the rule protects is the player who
 * had a card in hand and mana open, for whom the click buys the answer to "what
 * is about to happen" while there is still time to play something. A player
 * whose only offer is the pass, or the pass and tapping a land, is not being
 * protected by that prompt — they are being asked to watch, which is what a stop
 * is for, and they said where they wanted those. Unqualified, this rule made
 * every spell the other seat cast cost a press that could only ever say "let it
 * resolve".
 *
 * **Two stacks qualify, and the second one is `mtg-bz2.4`.** The other seat's
 * spell has always been here. Your own is the window CR 117.3c hands back after
 * you cast (`holdsOwnTopOfStack`), and it is the window Magic Online spends a
 * whole control on: holding priority to answer your own spell, which is how a
 * player stacks two effects in an order the rules would otherwise not give them.
 * It is a rule here rather than a toggle for the reason the opposing-spell half
 * is one — the alternative is a switch that is off when it matters, and a player
 * whose spell resolved before they could respond to it has lost a game to an
 * interface preference. A stop set cannot express it: the window falls in
 * whatever step the cast happened in, and ticking that step asks about every
 * other priority in it too.
 *
 * **What it costs was measured, and the answer is nothing so far.** Twenty
 * seeded games — five seeds by four stop configurations, driven through
 * `createSession` off a deck cut from the flagship set — changed not one
 * decision under this half of the rule. The position arises about once a game
 * and roughly half the time with an answer in hand, and every one of those
 * windows fell in a step the configuration already stopped at, so the question
 * was going to be asked anyway.
 *
 * That is the argument for it rather than against it. Those games were covered
 * by luck of the stop set, and the phase bar makes unticking a stop one click
 * (`@mtg/ui`, `mtg-bz2.1`); a player who unticks the step they cast in loses
 * the coverage and does not find out until a spell of theirs resolves before
 * they could answer it. `test/own-spell-priority.test.ts` builds exactly that
 * configuration and shows the difference: without this clause the spell resolves
 * with a second one still castable in hand.
 *
 * A stop still stops. This decides only whether the stack forces a question that
 * the settings would otherwise have passed.
 */
function stackWantsAnAnswer(state: GameState, decision: Decision): boolean {
  const waiting = opposingStack(state, decision.player).size > 0 || holdsOwnTopOfStack(state, decision);
  return waiting && canRespond(decision);
}

/**
 * The index of the only thing that can happen, or `null` when the player has a
 * question to answer.
 *
 * It is also what makes a yield safe without the yield having to police the
 * priorities `advance` plays inside a single `choose`.
 *
 * **The position it fires at is one no rule above can want a question at, so it
 * consults none of them.** The kernel puts `passPriority` in every priority it
 * enumerates, so a priority enumerated with one option is the pass alone and
 * `canRespond` is false by construction — which makes `stackWantsAnAnswer` and
 * `stopWantsAQuestion` both false here whatever the stack holds and whatever the
 * stop set names. Reading the state to ask them would be running two conditions
 * that cannot come out true; the function takes no state for the same reason.
 * `test/autopass.test.ts` holds the enumeration fact those two words rest on.
 *
 * **It is not restricted to a priority, and that restriction is `mtg-y1t.3`.**
 * Two attacking creatures with flying and nothing on the defending board that
 * flies or reaches: `blockerDecision` filters every pair through `canBlock`, so
 * it enumerates exactly one declaration — block nothing — and the surface
 * stopped and made a player press it by hand. The argument above never once
 * says "priority". It says the position had one continuation whichever way the
 * question was answered, which is a property of the option count and of nothing
 * else, and it is as true of a forced block as of a bare pass. The distinction
 * this codebase draws is that a beat pauses to show you something and records
 * nothing, while a stop is a place you are asked to act; a decision with one
 * legal option is not a place anyone is asked to act.
 *
 * **A truncated enumeration is never settled**, and that is the one way widening
 * this could have gone wrong. `blockerDecision` falls back to a lone
 * `blocks: []` when the 512-option cap left nothing valid, so a crowded board
 * can present one option and mean "512 were not enough", which is the opposite
 * of forced. `complete` tells the two apart.
 *
 * **What it does to the recording is nothing**, which is why it can be widened
 * without regenerating a fixture. `session.ts` puts the taken index through the
 * same `reduce` and appends it to `choices` exactly as a pressed button would,
 * and `replaySession` clears the settings and runs at full control, so a game
 * recorded before this widened and a game recorded after hold the same integers
 * and replay through the same questions.
 */
export function settledChoice(decision: Decision, settings: AutoPassSettings): number | null {
  if (!settings.enabled) return null;
  if (!decision.complete) return null;
  if (decision.options.length !== 1) return null;
  return 0;
}

/**
 * The index to pass with because no stop named this step, or `null` when the
 * player has to be asked.
 *
 * The other half of the stop set: `autoPassChoice` lets a stop *add* a question,
 * and this lets the absence of one take a question away. A player who unticks
 * every box but their two main phases is asking for exactly this, and until it
 * existed they got nothing — one untapped land puts a mana ability in every
 * enumeration, so from the first land on there was no single-option priority
 * left for the structural rule to fire at and the set was inert.
 *
 * **The pass it returns is a decision and is recorded as one.** It is the index
 * of the same `passPriority` a pressed button would have taken, appended to
 * `choices` by the same line of `session.ts`, so the recording is a game that
 * replays. What it is not is a game identical to the one a full-control player
 * would have recorded, because they were offered plays here and this player
 * asked not to be. The module docblock carries that split at length.
 *
 * The two rules it does not get to override are the two that make it safe: it
 * never passes through a spell the player did not cast and could have answered,
 * and it has no opinion on a decision that is not a priority. So blockers,
 * orderings, targets, a discard and the opening hand are all still asked about,
 * which is what keeps an empty stop set from meaning an unwatched game.
 */
export function unstoppedPassChoice(
  state: GameState,
  decision: Decision,
  settings: AutoPassSettings,
): number | null {
  if (!settings.enabled || !settings.passUnstopped) return null;
  if (decision.kind !== 'priority') return null;
  if (stackWantsAnAnswer(state, decision)) return null;
  if (stopWantsAQuestion(state, decision, settings.stops)) return null;
  return passIndex(decision);
}

/** Where `passPriority` sits in an enumeration, or `null` when it is not in one. */
export function passIndex(decision: Decision): number | null {
  const index = decision.options.findIndex((option) => option.type === 'passPriority');
  return index < 0 ? null : index;
}

/**
 * True once a yield started in `startedOnTurn` has run to its boundary.
 *
 * `endOfTurn` is Magic Online's F6 and `yourNextTurn` its F4: the first hands
 * the game back as soon as the turn it was pressed in is over, the second holds
 * on through the opponent's turn and gives it back at the start of the next one
 * the player is active in.
 */
export function reachedBoundary(
  state: GameState,
  player: PlayerId,
  boundary: YieldBoundary,
  startedOnTurn: number,
): boolean {
  if (state.turn.number === startedOnTurn) return false;
  return boundary === 'endOfTurn' || state.turn.active === player;
}
