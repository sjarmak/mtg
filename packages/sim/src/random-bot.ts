/**
 * A random-policy bot: the proof that the agent seam is pluggable.
 *
 * It is not `@mtg/kernel`'s `randomAgent` re-exported. That one samples the
 * enumerated option list; this one *constructs* its own attack, block, ordering
 * and discard declarations from a seeded generator, exactly as the greedy bot
 * does, so swapping it in exercises the same code path — including
 * `validateAction`'s guarantee that a self-constructed declaration is checked
 * as hard as an enumerated one.
 *
 * Its generator is seeded per agent and kept out of the game state, so it never
 * perturbs shuffles: a run is reproducible from (run seed, game index) whether
 * the seats hold greedy bots or random ones.
 */
import type {
  Action,
  AgentView,
  AttackDeclaration,
  BlockDeclaration,
  ObjectId,
  PlayerAgent,
} from '@mtg/kernel';
import { canBlock, validateBlocks } from '@mtg/kernel';

/** Deterministic 32-bit generator; mulberry32 over an FNV-1a seed hash. */
export interface Rng {
  state: number;
}

export function createRng(seed: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { state: hash >>> 0 };
}

export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let value = rng.state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function nextBelow(rng: Rng, bound: number): number {
  if (bound <= 0) return 0;
  return Math.floor(nextFloat(rng) * bound) % bound;
}

function randomSubset<T>(rng: Rng, items: readonly T[]): readonly T[] {
  return items.filter(() => nextFloat(rng) < 0.5);
}

function shuffled<T>(rng: Rng, items: readonly T[]): readonly T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = nextBelow(rng, index + 1);
    const a = copy[index];
    const b = copy[swap];
    if (a === undefined || b === undefined) continue;
    copy[index] = b;
    copy[swap] = a;
  }
  return copy;
}

const BLOCK_ATTEMPTS = 8;

function randomBlocks(
  view: AgentView,
  rng: Rng,
  attackers: readonly ObjectId[],
  eligible: readonly ObjectId[],
): readonly BlockDeclaration[] {
  if (attackers.length === 0 || eligible.length === 0) return [];
  for (let attempt = 0; attempt < BLOCK_ATTEMPTS; attempt += 1) {
    const blocks: BlockDeclaration[] = [];
    for (const blocker of eligible) {
      if (nextFloat(rng) < 0.5) continue;
      const legal = attackers.filter((attacker) => canBlock(view.state, blocker, attacker));
      const attacker = legal[nextBelow(rng, legal.length)];
      if (attacker === undefined) continue;
      blocks.push({ blocker, attacker });
    }
    if (validateBlocks(view.state, view.player, blocks) === null) return blocks;
  }
  return [];
}

function decideRandom(view: AgentView, rng: Rng): Action {
  const me = view.player;
  switch (view.decision.kind) {
    case 'priority': {
      const options = view.decision.options;
      const chosen = options[nextBelow(rng, options.length)];
      if (chosen === undefined) return { type: 'passPriority', player: me };
      return chosen;
    }
    case 'declareAttackers': {
      const decision = view.decision;
      const attackers = randomSubset(rng, decision.eligible).map((oid): AttackDeclaration => ({
        oid,
        defender: decision.defenders[nextBelow(rng, decision.defenders.length)] ?? decision.defender,
      }));
      return { type: 'declareAttackers', player: me, attackers };
    }
    case 'declareBlockers':
      return {
        type: 'declareBlockers',
        player: me,
        blocks: randomBlocks(view, rng, view.decision.attackers, view.decision.eligible),
      };
    case 'orderBlockers':
      return {
        type: 'orderBlockers',
        player: me,
        orders: view.decision.blocks.map((block) => ({
          attacker: block.attacker,
          blockers: shuffled(rng, block.blockers),
        })),
      };
    case 'discard':
      return {
        type: 'discard',
        player: me,
        oids: shuffled(rng, view.decision.hand).slice(0, view.decision.count),
      };
    case 'handDiscard': {
      const decision = view.decision;
      // Sampled like the cleanup discard above and then put back in hand order,
      // which that one does not need and this one does: `canonicalAction` sorts
      // a `discard`'s ids before comparing, and it deliberately leaves this
      // action's alone, because the order of a `chooseDiscards` is the order
      // `validateSelection` reads a partial selection in.
      const picked = new Set(shuffled(rng, decision.hand).slice(0, decision.count));
      return {
        type: 'chooseDiscards',
        player: me,
        oids: decision.hand.filter((oid) => picked.has(oid)),
      };
    }
    case 'mulligan': {
      // A coin flip until the rules stop offering one, and the cards it pays
      // with are random too. This bot is the proof that the seam is pluggable,
      // so the policy it plays should be the one that reads a hand least.
      const canMulligan = view.decision.options.some((option) => option.type === 'mulligan');
      if (canMulligan && nextFloat(rng) < 0.5) return { type: 'mulligan', player: me };
      return {
        type: 'keepHand',
        player: me,
        bottom: shuffled(rng, view.decision.hand).slice(0, view.decision.count),
      };
    }
    // These decisions are sampled rather than constructed, for the reason
    // `priority` is: the kernel enumerates a trigger's legal target tuples (CR
    // 603.3d), the two answers to a triggered ability's or a spell's "you may"
    // (CR 603.3b, CR 601.2c) and the same-named legends one seat controls (CR
    // 704.5j), and there is no declaration space here large enough to be worth
    // building by hand. Sampling them is also what makes this bot useful
    // against the new stops — it declines optional triggers and may spells
    // about half the time, and keeps the newer legend as often as the older,
    // which the greedy bot never does on a board where the other answer is
    // correct.
    case 'triggerTargets':
    case 'optionalTrigger':
    case 'may':
    case 'unless':
    case 'legendRule':
    case 'scry':
    case 'searchLibrary':
    case 'graveyardChoice':
    case 'permanentSacrifice': {
      const options = view.decision.options;
      const chosen = options[nextBelow(rng, options.length)];
      if (chosen === undefined) throw new Error('random bot: the kernel offered no legal option');
      return chosen;
    }
  }
}

/** A random-policy bot seeded independently of the game RNG. */
export function randomBot(name: string, seed: string): PlayerAgent {
  const rng = createRng(seed);
  return {
    name,
    decide(view: AgentView): Action {
      return decideRandom(view, rng);
    },
  };
}
