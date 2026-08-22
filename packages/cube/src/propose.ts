/**
 * The semantic half: the model says which cards serve which archetype, and code
 * checks every word of it against the store.
 *
 * The model is asked for names and archetype tags and nothing else. It is not
 * asked how many cards each color should hold, how the curve should fall, or
 * whether the cube is big enough for the pod — those are arithmetic `validate.ts`
 * does exactly, and a model asked to do them produces a plausible number rather
 * than a correct one. What it is asked for is the judgment code must not make:
 * whether a card advances a named archetype.
 *
 * Nothing it returns is trusted. A name may be a card that does not exist, or
 * one that exists and is banned in the format, or one that exists and is legal
 * and cannot be cast in the archetype's colors. Each is a different rejection
 * with a different fix, and each is handed back by name so the next round can
 * repair it rather than the build failing on it.
 */
import { z } from 'zod';
import type { LlmProvider } from '@mtg/llm';
import type { CandidateCard } from '@mtg/decklab';
import { normalizeName } from '@mtg/decklab';
import { COLORS } from '@mtg/dsl';
import type { CubeArchetype, CubeCriteria } from './criteria';
import { bandLabel, cubeCopyLimit, draftCapacity } from './criteria';
import type { CubePool } from './universe';
import type { CubeEntry } from './validate';
import { measuredColors, percent, withinArchetype } from './validate';

/**
 * The answer shape, which follows the cube's own criteria.
 *
 * `archetypes` is required when the cube states archetypes and empty when it
 * states none, because the schema, the prompt and the gate all have to say the
 * same thing. A schema that always demanded a tag made the archetype-less cube
 * — which is what `CubeCriteriaSchema` defaults to — impossible to build: the
 * prompt told the model to tag nothing, the schema forbade obeying it, and the
 * gate rejected every card it tagged instead.
 */
function proposalSchema(tagged: boolean) {
  const cards = z.object({
    name: z.string().min(1).describe('exact printed card name'),
    count: z.int().min(1).max(4).default(1).describe('copies; 1 in a singleton cube'),
    archetypes: tagged
      ? z
          .array(z.string().min(1))
          .min(1)
          .describe('names of the stated archetypes this card serves; use the names given, verbatim')
      : z.array(z.string().min(1)).max(0).describe('this cube states no archetypes, so return an empty list'),
    reason: z.string().min(1).describe('one sentence on why this card serves those archetypes'),
  });

  return z.object({
    cards: z.array(cards).min(1),
    plan: z.string().min(1).describe('two or three sentences on what this cube is for'),
  });
}

const TAGGED_PROPOSAL_SCHEMA = proposalSchema(true);
const UNTAGGED_PROPOSAL_SCHEMA = proposalSchema(false);

/** The schema this cube's answers are held to. */
export function cubeProposalSchema(criteria: CubeCriteria): ReturnType<typeof proposalSchema> {
  return criteria.archetypes.length === 0 ? UNTAGGED_PROPOSAL_SCHEMA : TAGGED_PROPOSAL_SCHEMA;
}

export type CubeProposal = z.infer<typeof TAGGED_PROPOSAL_SCHEMA>;
export type CubeCardProposal = CubeProposal['cards'][number];

export type CubeRejectionCode =
  /** No card of that name exists in the store: the model invented it. */
  | 'unknown-card'
  /** A real card the cube's restrictions exclude. */
  | 'not-in-universe'
  /** Named twice in one answer, or already in the cube. */
  | 'duplicate'
  /** Tagged with an archetype the criteria never stated. */
  | 'unstated-archetype'
  /** Tagged with an archetype whose colors cannot cast it. */
  | 'off-color'
  /** More copies than the cube's copy limit allows. */
  | 'too-many-copies'
  /** Correct in every other way, but the cube is already full. */
  | 'over-size';

export interface CubeRejection {
  readonly name: string;
  readonly code: CubeRejectionCode;
  /** Feedback phrased for the model, naming the fix. */
  readonly detail: string;
}

export interface CubeVerifyResult {
  readonly inclusions: readonly CubeEntry[];
  readonly rejections: readonly CubeRejection[];
}

export interface VerifyCubeInput {
  readonly proposals: readonly CubeCardProposal[];
  readonly pool: CubePool;
  readonly criteria: CubeCriteria;
  /** What the cube already holds, so a repeat is a repeat and not a new card. */
  readonly accepted: readonly CubeEntry[];
  /** Cards the cube still has room for. */
  readonly room: number;
}

const CUBE_SYSTEM_LINES: readonly string[] = [
  'You are a Magic: the Gathering cube designer.',
  'You choose which cards belong in a cube and which archetypes each one serves.',
  'You never compute the colour split, the curve or the size; those are',
  'calculated from your picks, and anything you say about them is discarded.',
  'Propose only real cards whose exact printed names you are certain of.',
];

const CUBE_TAGGING_RULE =
  'Every card must be tagged with at least one of the stated archetype names, verbatim.';

/**
 * The standing instructions, minus the tagging rule when the cube states no
 * archetypes: "tag from the stated names" over an empty list is an instruction
 * that cannot be followed, and the schema and the prompt both say so too.
 */
export function cubeSystem(criteria: CubeCriteria): string {
  const lines =
    criteria.archetypes.length === 0 ? CUBE_SYSTEM_LINES : [...CUBE_SYSTEM_LINES, CUBE_TAGGING_RULE];
  return lines.join(' ');
}

export function verifyCubeProposals(input: VerifyCubeInput): CubeVerifyResult {
  const gate: Gate = {
    pool: input.pool,
    archetypes: new Map(input.criteria.archetypes.map((archetype) => [archetype.name, archetype])),
    limit: cubeCopyLimit(input.criteria),
    seen: new Set(input.accepted.map((entry) => normalizeName(entry.card.name))),
    room: input.room,
  };

  const inclusions: CubeEntry[] = [];
  const rejections: CubeRejection[] = [];

  for (const proposal of input.proposals) {
    const judged = judge(proposal, gate);
    if (!judged.ok) {
      rejections.push(judged.rejection);
      continue;
    }
    gate.seen.add(normalizeName(proposal.name));
    gate.room -= proposal.count;
    inclusions.push({
      card: judged.card,
      count: proposal.count,
      archetypes: proposal.archetypes,
      reason: proposal.reason,
    });
  }

  return { inclusions, rejections };
}

/** What the checks are made against, and what the ones already taken changed. */
interface Gate {
  readonly pool: CubePool;
  readonly archetypes: ReadonlyMap<string, CubeArchetype>;
  readonly limit: number;
  readonly seen: Set<string>;
  room: number;
}

/**
 * Either the store row this proposal names, or the reason it cannot have one.
 *
 * The card comes back with the verdict rather than being looked up again by the
 * caller: two lookups is two places for "the universe holds it" to be decided,
 * and only one of them would carry the reason it does not.
 */
type Judgment =
  | { readonly ok: true; readonly card: CandidateCard }
  | { readonly ok: false; readonly rejection: CubeRejection };

function judge(proposal: CubeCardProposal, gate: Gate): Judgment {
  const { name } = proposal;
  const key = normalizeName(name);
  if (gate.seen.has(key)) {
    return reject(name, 'duplicate', `${name} is already in the cube; name a different card`);
  }

  const card = gate.pool.universe.byName.get(key);
  if (card === undefined) {
    return gate.pool.knownNames.has(key)
      ? reject(
          name,
          'not-in-universe',
          `${name} is a real card but the cube's restrictions exclude it (format legality, layout, or price ceiling)`,
        )
      : reject(
          name,
          'unknown-card',
          // Not "not a card in the store": a cube cut from a generated set is
          // told by `setCubePool` that the set is the only world there is, and
          // over that pool this fires for real store cards. Lightning Bolt is a
          // card in the store, and a cube built from `--set` that said otherwise
          // would be arguing with a model that happened to be right.
          `no card named ${name} exists in the cards this cube is built from; propose only names you are certain of`,
        );
  }

  if (proposal.count > gate.limit) {
    return reject(
      name,
      'too-many-copies',
      `${name} asked for ${String(proposal.count)} copies; the limit here is ${String(gate.limit)}`,
    );
  }

  const unstated = proposal.archetypes.filter((tag) => !gate.archetypes.has(tag));
  if (unstated.length > 0) {
    return reject(name, 'unstated-archetype', unstatedDetail(name, unstated, gate));
  }

  for (const tag of proposal.archetypes) {
    const archetype = gate.archetypes.get(tag);
    if (archetype === undefined || withinArchetype(card, archetype)) continue;
    return reject(
      name,
      'off-color',
      `${name} has colour identity {${card.colorIdentity}} and cannot be cast in ${tag} ({${archetype.colors.join('')}}); tag it with an archetype that can`,
    );
  }

  if (proposal.count > gate.room) {
    return reject(
      name,
      'over-size',
      `${name} does not fit: the cube has room for ${String(Math.max(0, gate.room))} more card(s)`,
    );
  }

  return { ok: true, card };
}

function reject(name: string, code: CubeRejectionCode, detail: string): Judgment {
  return { ok: false, rejection: { name, code, detail } };
}

/**
 * A cube that states no archetypes has no list to tag from, so it is told to
 * stop tagging rather than handed "tag only from: " with nothing after it.
 */
function unstatedDetail(name: string, unstated: readonly string[], gate: Gate): string {
  const tagged = unstated.join(', ');
  if (gate.archetypes.size === 0) {
    return `${name} is tagged ${tagged}; this cube states no archetypes, so leave every card untagged`;
  }
  return `${name} is tagged ${tagged}, which this cube does not run; tag only from: ${[...gate.archetypes.keys()].join(', ')}`;
}

/** One round: ask for `need` more cards and hand back what the model said. */
export async function proposeCubeCards(
  provider: LlmProvider,
  criteria: CubeCriteria,
  pool: CubePool,
  need: number,
  accepted: readonly CubeEntry[],
  rejections: readonly CubeRejection[],
): Promise<CubeProposal> {
  const { value } = await provider.complete({
    system: cubeSystem(criteria),
    prompt: buildCubePrompt(criteria, pool, need, accepted, rejections),
    schema: cubeProposalSchema(criteria),
  });
  return value;
}

export function buildCubePrompt(
  criteria: CubeCriteria,
  pool: CubePool,
  need: number,
  accepted: readonly CubeEntry[],
  rejections: readonly CubeRejection[],
): string {
  const lines: string[] = [
    `The designer asked for: ${criteria.prompt}`,
    '',
    `A ${String(criteria.size)}-card ${criteria.singleton ? 'singleton ' : ''}cube, legal in ${criteria.format},`,
    `drafted by ${String(criteria.seats)} players taking ${String(criteria.cardsPerSeat)} cards each (${String(draftCapacity(criteria))} cards in a pod).`,
    `Choose ${String(need)} more cards.`,
    '',
    ...archetypeLines(criteria),
    ...shapeLines(criteria),
    '',
    'Structural filters already applied to the legal card pool:',
    ...pool.universe.filters.map((filter) => `  ${filter}`),
    `The pool holds ${String(pool.universe.cards.length)} legal cards. A card outside it will be rejected.`,
  ];

  if (accepted.length > 0) {
    lines.push(
      '',
      'Already in the cube — do not propose these again:',
      ...accepted.map((entry) => `  ${entry.card.name}`),
    );
  }
  if (rejections.length > 0) {
    lines.push(
      '',
      'Your previous answer had these problems. Replace those cards:',
      ...rejections.map((rejection) => `  ${rejection.detail}`),
    );
  }
  return lines.join('\n');
}

function archetypeLines(criteria: CubeCriteria): readonly string[] {
  if (criteria.archetypes.length === 0) {
    return [
      'This cube states no archetypes: return an empty archetypes list on every card,',
      'and choose on the designer’s words alone.',
    ];
  }
  return [
    'Archetypes. Tag every card with the names it serves, verbatim:',
    ...criteria.archetypes.map(
      (archetype) =>
        `  ${archetype.name} ({${archetype.colors.join('')}}) — needs at least ${String(archetype.minPlayable)} playable cards`,
    ),
    'A card may serve more than one. Its colour identity must fit inside every archetype you tag it with.',
  ];
}

/**
 * The share this asks for is the share `validate.ts`'s `colorFindings` measures
 * against: an even split of `measuredColors(criteria)`, which is every color
 * when the cube states no archetypes and the union of the *stated* archetypes'
 * colors when it does — a quarter across boros-plus-dimir's four, not the fifth
 * a fixed fraction would say regardless of what was stated. Derived rather than
 * hardcoded so the two can never drift apart again the way they did in
 * `mtg-bc2.136`.
 */
function shapeLines(criteria: CubeCriteria): readonly string[] {
  const colors = measuredColors(criteria);
  const scope =
    colors.length === COLORS.length
      ? 'the coloured slots'
      : `the slots in the archetypes' colours {${colors.join('')}}`;
  const lines = [
    '',
    `Colour balance is measured afterwards: each colour should hold about an even share (${percent(1 / colors.length)}) of ${scope}, within ${(criteria.colorBalanceTolerance * 100).toFixed(1)} points.`,
  ];
  if (criteria.maxCardUsd !== undefined) {
    lines.push(`Every card in the pool already costs at most $${String(criteria.maxCardUsd)}.`);
  }
  if (criteria.curve.length > 0) {
    lines.push(
      'The finished curve is measured against these bands:',
      ...criteria.curve.map(
        (band) =>
          `  ${bandLabel(band)}: ${String(band.minCards)}-${String(band.maxCards)} of the non-land cards`,
      ),
    );
  }
  return lines;
}
