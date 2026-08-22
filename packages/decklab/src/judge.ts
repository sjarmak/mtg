/**
 * The blind half of the comparison: which deck actually better serves what the
 * player asked for.
 *
 * Legality and budget are facts, and `audit.ts` settles them. Whether a deck's
 * cards work together, and whether they answer the request, is a judgment, so
 * it goes to a model — the ZFC line again, applied to evaluation rather than
 * construction.
 *
 * Blinding is the whole point and it is easy to get wrong:
 *
 * - The two decks are presented as A and B with **no** indication of origin.
 *   A judge told which deck came from the sophisticated pipeline will find
 *   reasons to prefer it.
 * - Their order is shuffled from a seed, because a judge shown the same builder
 *   in position A every time will bake in whatever position bias it has.
 * - Neither the builders' plans nor their justifications are shown. The
 *   informed builder writes a citation per card and the baseline does not, so
 *   including them would let the judge identify the source by formatting alone
 *   and reward the deck that argued for itself best rather than the better deck.
 * - The verdict comes back as a side label, and the caller maps it to a builder
 *   afterwards using the shuffle it applied.
 */
import { z } from 'zod';
import { createRng, shuffle } from '@mtg/kernel';
import type { LlmProvider } from '@mtg/llm';
import type { DeckEntry } from './audit';
import type { DeckCriteria } from './criteria';
import { enumerateCriteria } from './criteria';

export const VerdictSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']),
  reason: z.string().min(1).describe('one or two sentences citing specific cards'),
  scoreA: z.int().min(0).max(10).describe('how well deck A serves the request'),
  scoreB: z.int().min(0).max(10),
});

export type Verdict = z.infer<typeof VerdictSchema>;

const SYSTEM = [
  'You judge Magic: the Gathering decks.',
  'You are given a request and two anonymous decklists.',
  'Say which better serves the request and why, citing specific cards.',
  'Judge only the cards. You have no information about who or what built either deck.',
].join(' ');

export type Side = 'A' | 'B';

/** Which builder ended up on which side, for un-blinding after the verdict. */
export interface Blinding {
  readonly informed: Side;
  readonly baseline: Side;
}

export interface JudgeResult {
  readonly verdict: Verdict;
  readonly blinding: Blinding;
  /** The verdict mapped back onto builders. */
  readonly winner: 'informed' | 'baseline' | 'tie';
  readonly informedScore: number;
  readonly baselineScore: number;
}

export interface JudgeInput {
  readonly provider: LlmProvider;
  readonly criteria: DeckCriteria;
  readonly informed: readonly DeckEntry[];
  readonly baseline: readonly DeckEntry[];
  /** Seed for the A/B shuffle; the same seed reproduces the same blinding. */
  readonly seed: string;
}

export async function judgeBlind(input: JudgeInput): Promise<JudgeResult> {
  const [order] = shuffle(['informed', 'baseline'] as const, createRng(input.seed));
  const first = order[0] ?? 'informed';
  const blinding: Blinding =
    first === 'informed' ? { informed: 'A', baseline: 'B' } : { informed: 'B', baseline: 'A' };

  const deckA = blinding.informed === 'A' ? input.informed : input.baseline;
  const deckB = blinding.informed === 'A' ? input.baseline : input.informed;

  const { value } = await input.provider.complete({
    system: SYSTEM,
    prompt: buildPrompt(input.criteria, deckA, deckB),
    schema: VerdictSchema,
  });

  const informedScore = blinding.informed === 'A' ? value.scoreA : value.scoreB;
  const baselineScore = blinding.baseline === 'A' ? value.scoreA : value.scoreB;
  const winner =
    value.winner === 'tie' ? 'tie' : value.winner === blinding.informed ? 'informed' : 'baseline';

  return { verdict: value, blinding, winner, informedScore, baselineScore };
}

function buildPrompt(
  criteria: DeckCriteria,
  deckA: readonly DeckEntry[],
  deckB: readonly DeckEntry[],
): string {
  return [
    `The player asked for: ${criteria.prompt}`,
    '',
    'What they stated:',
    ...enumerateCriteria(criteria).map((criterion) => `  ${criterion.statement}`),
    '',
    'Deck A:',
    ...formatDeck(deckA),
    '',
    'Deck B:',
    ...formatDeck(deckB),
  ].join('\n');
}

/** Both decks print identically, so formatting cannot betray the source. */
function formatDeck(entries: readonly DeckEntry[]): string[] {
  return [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `  ${entry.count}x ${entry.name}`);
}
