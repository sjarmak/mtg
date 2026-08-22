/**
 * The framed decision: everything the model is allowed to read, and nothing
 * else.
 *
 * This is a pure function of an `AgentView`, and it is the whole of the
 * referee's read access. Two properties are load-bearing.
 *
 * The first is redaction. The kernel's state holds both libraries and both
 * hands because it has to; the seat being asked can see neither library nor the
 * opponent's hand. A frame that leaked them would make a refereed game a game
 * with a cheat in it, and the leak would be invisible — the ruling would still
 * be legal. So hidden zones are reported as counts, and the count is stated
 * rather than omitted, because "your opponent holds three cards" is public and
 * knowing it matters.
 *
 * The second is that the options are the kernel's own list, numbered in its
 * order. When the list has to be shortened it is shortened by taking a prefix,
 * so every index the model can see still addresses the action the kernel put
 * there. `enumerationComplete` carries the kernel's own admission that a capped
 * enumeration is a subset of the legal space, which is the one place where a
 * deterministic handler is genuinely missing something.
 */
import { formatManaCost } from '@mtg/dsl';
import type { AgentView, Decision, GameState, PlayerId, PlayerState } from '@mtg/kernel';
import { describeAction, describeHandCard, describePermanent, describeSeat } from './describe';

/** Options past this many are dropped from the frame, to bound prompt size. */
const DEFAULT_MAX_OPTIONS = 40;

export interface FramedOption {
  /** The index into `decision.options`; this is what a ruling names. */
  readonly index: number;
  readonly summary: string;
}

export interface FramedPlayer {
  readonly player: PlayerId;
  readonly life: number;
  readonly handSize: number;
  /** Card lines, or `null` when this hand is hidden from the asking seat. */
  readonly hand: readonly string[] | null;
  readonly librarySize: number;
  readonly graveyard: readonly string[];
  readonly battlefield: readonly string[];
}

export interface FramedTurn {
  readonly number: number;
  readonly step: string;
  readonly active: PlayerId;
  readonly priority: PlayerId | null;
}

export interface RefereeFrame {
  readonly asking: PlayerId;
  readonly kind: Decision['kind'];
  readonly question: string;
  readonly turn: FramedTurn;
  /** Indexed by seat, as `GameState.players` is. */
  readonly players: readonly [FramedPlayer, FramedPlayer];
  readonly stack: readonly string[];
  readonly exile: readonly string[];
  readonly combat: readonly string[];
  readonly options: readonly FramedOption[];
  /** Options dropped from the tail to bound prompt size. */
  readonly omittedOptions: number;
  /** The kernel's own report that its enumeration covered the legal space. */
  readonly enumerationComplete: boolean;
}

export interface FrameOptions {
  /** Defaults to 40, which is what bounds the prompt on a wide board. */
  readonly maxOptions?: number;
}

export function frameDecision(view: AgentView, options: FrameOptions = {}): RefereeFrame {
  const { state, player, decision } = view;
  const limit = options.maxOptions ?? DEFAULT_MAX_OPTIONS;
  if (!Number.isInteger(limit) || limit < 1) {
    // Zero options is a frame that can only be answered wrongly, so it is a
    // caller bug rather than a small prompt.
    throw new Error(`frameDecision: maxOptions must be an integer >= 1, got ${String(limit)}`);
  }
  const shown = decision.options.slice(0, limit);

  return {
    asking: player,
    kind: decision.kind,
    question: questionFor(state, decision),
    turn: {
      number: state.turn.number,
      step: state.turn.step,
      active: state.turn.active,
      priority: state.turn.priority,
    },
    players: [framePlayer(state, 0, player), framePlayer(state, 1, player)],
    stack: state.stack.map(
      (entry) => `${describePermanent(state, entry.oid)} (controlled by ${describeSeat(entry.controller)})`,
    ),
    exile: state.exile.map((oid) => describePermanent(state, oid)),
    combat: frameCombat(state),
    options: shown.map((action, index) => ({ index, summary: describeAction(state, action) })),
    omittedOptions: decision.options.length - shown.length,
    enumerationComplete: decision.complete,
  };
}

function framePlayer(state: GameState, seat: PlayerId, asking: PlayerId): FramedPlayer {
  const player: PlayerState = state.players[seat];
  const own = seat === asking;
  return {
    player: seat,
    life: player.life,
    handSize: player.hand.length,
    hand: own ? player.hand.map((oid) => describeHandCard(state, oid)) : null,
    librarySize: player.library.length,
    graveyard: player.graveyard.map((oid) => {
      const object = state.objects[oid];
      return object === undefined ? oid : object.card.name;
    }),
    battlefield: state.battlefield
      .filter((oid) => state.objects[oid]?.controller === seat)
      .map((oid) => describePermanent(state, oid)),
  };
}

function frameCombat(state: GameState): readonly string[] {
  const lines = state.combat.attacks.map(
    (attack) =>
      `${describePermanent(state, attack.oid)} is attacking ${
        typeof attack.defender === 'number'
          ? describeSeat(attack.defender)
          : describePermanent(state, attack.defender.oid)
      }`,
  );
  const blocks = state.combat.blocks.map(
    (block) =>
      `${describePermanent(state, block.attacker)} is blocked by ` +
      block.blockers.map((blocker) => describePermanent(state, blocker)).join(', '),
  );
  return [...lines, ...blocks];
}

/** The question this decision kind actually poses, in the seat's own terms. */
function questionFor(state: GameState, decision: Decision): string {
  switch (decision.kind) {
    case 'mulligan':
      return (
        `You are deciding your opening hand (CR 103.4) after ${String(decision.mulligans)} mulligan(s), ` +
        `so keeping puts ${String(decision.count)} card(s) on the bottom of your library. ` +
        'Do you keep this hand, and which cards go to the bottom?'
      );
    case 'priority':
      return (
        `You hold priority in the ${state.turn.step} step of turn ${String(state.turn.number)}. ` +
        'Which action do you take?'
      );
    case 'declareAttackers':
      return `You are declaring attackers against ${decision.defenders
        .map((defender) =>
          typeof defender === 'number' ? describeSeat(defender) : describePermanent(state, defender.oid),
        )
        .join(' or ')}. Which attack do you declare?`;
    case 'declareBlockers':
      return (
        `You are declaring blockers against ${String(decision.attackers.length)} attacker(s). ` +
        'Which blocks do you declare?'
      );
    case 'orderBlockers':
      return 'Order the blockers for damage assignment (CR 509.2). Which order do you choose?';
    case 'discard':
      return `You are over your maximum hand size and must discard ${String(decision.count)} card(s). Which do you discard?`;
    case 'triggerTargets':
      return (
        'A triggered ability you control is being put on the stack and chooses its targets now (CR 603.3d). ' +
        'Which targets do you choose?'
      );
    case 'optionalTrigger':
      return (
        'A triggered ability you control says "you may" and is resolving (CR 603.3b). ' +
        'Do you carry it out?'
      );
    case 'may':
      return 'A spell says "you may" and is resolving (CR 601.2c). Do you carry it out?';
    case 'unless':
      return (
        `A spell aimed at you says it happens unless you pay ${formatManaCost(decision.cost)} ` +
        '(CR 118.8), and it is resolving. Do you pay?'
      );
    case 'legendRule':
      return (
        `You control ${String(decision.candidates.length)} legendary permanents named ${decision.name} ` +
        "(CR 704.5j). Which one do you keep? The rest go to their owners' graveyards."
      );
    case 'scry':
      return `You looked at ${String(decision.cards.length)} card(s). Which stay on top, which go to the bottom, and in what order?`;
    case 'searchLibrary':
      return `You searched your library and ${String(decision.cards.length)} card(s) match. Which do you take, or do you find nothing?`;
    // "in a graveyard", not "in your graveyard", because `whose: 'each'` reads
    // both — and no CR 701.19 cite, because this is not a search: a graveyard
    // is a public zone (CR 400.2), so nothing was revealed and nothing is
    // shuffled afterwards.
    case 'graveyardChoice':
      return `${String(decision.cards.length)} card(s) in a graveyard match a resolving effect. Which do you take, or do you take none?`;
    case 'handDiscard':
      // Two questions off one decision, and the frame has to pick the right one
      // outright rather than hedge: a model told "you must discard" about an
      // opponent's revealed hand would rule on the wrong seat's cards. `owner`
      // decides, and the reveal is named in the second because CR 701.16a is
      // why the seat can see what it is choosing from.
      return decision.owner === decision.player
        ? `A resolving effect makes you discard ${String(decision.count)} card(s) (CR 701.8). Which do you discard?`
        : `A resolving effect revealed ${describeSeat(decision.owner)}'s hand (CR 701.16a) and you choose ` +
            `${String(decision.count)} card(s) for them to discard (CR 701.8). Which do you choose?`;
    // "control", not "own", because CR 701.17a fixes the choice with the
    // permanent's controller, and no CR 701.19 cite for the same reason
    // `graveyardChoice` above has none: the battlefield is a public zone (CR
    // 403.2), so nothing here was revealed either.
    case 'permanentSacrifice':
      return `A resolving effect makes you sacrifice a creature you control (CR 701.17a). Which do you sacrifice?`;
  }
}
