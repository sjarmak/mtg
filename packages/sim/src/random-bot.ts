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
import { canBlock, requiredAttackers, satisfyMustBeBlocked, validateAction } from '@mtg/kernel';

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

/**
 * Random declarations are drawn again until the kernel accepts one.
 *
 * A uniform subset ignores CR 508.1d and 509.1c: a creature that attacks each
 * combat if able, a lure, an attacker that must be blocked by every able
 * creature. The draw therefore starts from what the requirement helpers the
 * greedy bot uses say is owed, and `validateAction` is the judge of the result,
 * so a requirement the helpers do not restate (a lured defender, a creature
 * that cannot attack alone) is still enforced by the kernel's own rules rather
 * than a second copy of them here. When every draw is refused the last one is
 * returned anyway, and the kernel refuses it loudly: a bot that quietly
 * declared nothing would hide the very failures a random seat exists to find.
 */
const DECLARATION_ATTEMPTS = 8;

type BlockersAction = Extract<Action, { type: 'declareBlockers' }>;

function randomAttackers(
  view: AgentView,
  rng: Rng,
  decision: Extract<AgentView['decision'], { kind: 'declareAttackers' }>,
): Action {
  const forced = requiredAttackers(view.state, decision.eligible, decision.defenders);
  let action: Action = { type: 'declareAttackers', player: view.player, attackers: [] };
  for (let attempt = 0; attempt < DECLARATION_ATTEMPTS; attempt += 1) {
    const attackers = decision.eligible
      // The draw comes first so a board with no requirement spends the same
      // numbers it always did, and its games replay unchanged.
      .filter((oid) => nextFloat(rng) < 0.5 || forced.has(oid))
      .map((oid): AttackDeclaration => ({
        oid,
        defender: decision.defenders[nextBelow(rng, decision.defenders.length)] ?? decision.defender,
      }));
    action = { type: 'declareAttackers', player: view.player, attackers };
    if (validateAction(view.state, action) === null) return action;
  }
  return action;
}

function randomBlocks(
  view: AgentView,
  rng: Rng,
  attackers: readonly ObjectId[],
  eligible: readonly ObjectId[],
): Action {
  let action: BlockersAction = { type: 'declareBlockers', player: view.player, blocks: [] };
  if (attackers.length === 0 || eligible.length === 0) return action;
  for (let attempt = 0; attempt < DECLARATION_ATTEMPTS; attempt += 1) {
    const blocks: BlockDeclaration[] = [];
    for (const blocker of eligible) {
      if (nextFloat(rng) < 0.5) continue;
      const legal = attackers.filter((attacker) => canBlock(view.state, blocker, attacker));
      const attacker = legal[nextBelow(rng, legal.length)];
      if (attacker === undefined) continue;
      blocks.push({ blocker, attacker });
    }
    action = { type: 'declareBlockers', player: view.player, blocks };
    if (validateAction(view.state, action) === null) return action;
  }
  // A must-be-blocked attacker almost never survives a coin flip per blocker,
  // so the last draw is repaired the way the greedy bot repairs its own. The
  // repair comes only after every draw failed, so a board the draws already
  // answer spends the same numbers it always did.
  const repaired = repairBlocks(view, action);
  return repaired ?? action;
}

function repairBlocks(view: AgentView, drawn: BlockersAction): Action | null {
  let blocks: readonly BlockDeclaration[];
  try {
    blocks = satisfyMustBeBlocked(view.state, drawn.blocks);
  } catch {
    // No completion of this draw obeys the requirements; the caller sends the
    // draw itself and the kernel names what it breaks.
    return null;
  }
  const repaired: Action = { type: 'declareBlockers', player: view.player, blocks };
  return validateAction(view.state, repaired) === null ? repaired : null;
}

function decideRandom(view: AgentView, rng: Rng): Action {
  const me = view.player;
  switch (view.decision.kind) {
    case 'cardName': {
      const names = Object.values(view.state.objects)
        .filter((object) => object.owner === me && !object.token)
        .map((object) => object.card.name);
      return {
        type: 'chooseCardName',
        player: me,
        name: names[nextBelow(rng, names.length)] ?? 'Black Lotus',
      };
    }
    case 'namedZoneExile': {
      const options = view.decision.options;
      const chosen = options[nextBelow(rng, options.length)];
      if (chosen === undefined) throw new Error('random bot: named-zone exile offered no legal option');
      return chosen;
    }
    case 'priority': {
      const options = view.decision.options;
      const chosen = options[nextBelow(rng, options.length)];
      if (chosen === undefined) return { type: 'passPriority', player: me };
      return chosen;
    }
    case 'manaColor': {
      const chosen = view.decision.options[nextBelow(rng, view.decision.options.length)];
      if (chosen === undefined) throw new Error('random bot: mana-color choice offered no option');
      return chosen;
    }
    case 'declareAttackers':
      return randomAttackers(view, rng, view.decision);
    case 'declareBlockers':
      return randomBlocks(view, rng, view.decision.attackers, view.decision.eligible);
    case 'orderBlockers':
      return {
        type: 'orderBlockers',
        player: me,
        orders: view.decision.blocks.map((block) => ({
          attacker: block.attacker,
          blockers: shuffled(rng, block.blockers),
        })),
      };
    case 'orderAttackers':
      return {
        type: 'orderAttackers',
        player: me,
        orders: view.decision.blocks.map((block) => ({
          blocker: block.blocker,
          attackers: shuffled(rng, block.attackers),
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
    case 'pluralTargets':
    case 'damageAllocation':
    case 'openingHandAction':
    case 'optionalTrigger':
    case 'may':
    case 'unless':
    case 'legendRule':
    case 'scry':
    case 'topLibraryOrder':
    case 'topLibrarySelect':
    case 'topLibraryPartition':
    case 'topLibraryPile':
    case 'searchLibrary':
    case 'searchDestination':
    case 'graveyardChoice':
    case 'battlefieldChoice':
    case 'populate':
    case 'permanentSacrifice':
    case 'permanentUntap':
    case 'entryCopy':
    case 'entryCounter':
    case 'entryAura':
    case 'entryTimestampOrder':
    case 'entryCharacteristics':
    case 'entryOptionalCounter':
    case 'entryPayLife':
    case 'entryPlayer':
    case 'entryColors':
    case 'spellTargets':
    case 'freeCast':
    case 'revealedHandChoice':
    case 'damagePrevention': {
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
