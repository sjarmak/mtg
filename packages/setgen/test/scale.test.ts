/**
 * The two passes that answer about a whole set at once, at 250 cards.
 *
 * `mtg-g7q3`. Both were sized against a 90-card slice and neither says so, which
 * is the shape of the failure: a cap that is generous at 90 and silently binding
 * at 250. The flavor pass is the loud one — its schema carries at most 120 lines
 * and a 250-card set has more cards with room than that — and the critique pass
 * is the quiet one, where the number everybody points at is not the number that
 * binds.
 *
 * Nothing here calls a model. Both passes are exercised through stubs, and the
 * one measurement that needed a real answer is read off the recorded run.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Keyword } from '@mtg/dsl';
import { exampleCard, renderOracleText } from '@mtg/dsl';
import type { CompletionRequest, CompletionResult, LlmProvider } from '@mtg/llm';
import { FixtureMissingError, toJsonSchema, unlimitedBudget, ZERO_USAGE } from '@mtg/llm';
import type { FlavorLine, SetBrief } from '@mtg/setgen';
import {
  CRITIQUE_BASE_SIZE,
  CritiqueSchema,
  critiqueBudget,
  critiqueSchemaFor,
  FLAVOR_BATCH_SIZE,
  parseBrief,
  writeFlavor,
} from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

const BRIEF: SetBrief = parseBrief(TEST_BRIEF);
/** A card with room in its box, so `cardsWithRoom` offers it to the writer. */
function roomy(id: string, keywords: readonly Keyword[] = ['flying']): Card {
  const base = exampleCard('slc-skywatch-sentinel');
  const card: Card = { ...base, id, keywords: [...keywords] };
  return { ...card, oracleText: renderOracleText(card) };
}

interface Recorded {
  readonly prompts: string[];
  readonly provider: LlmProvider;
}

/** A provider that answers one line per card it was shown, and keeps the prompts. */
function lineWriter(): Recorded {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    name: 'anthropic-api',
    model: 'stub',
    budget: unlimitedBudget(),
    complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
      prompts.push(request.prompt);
      const ids = [...request.prompt.matchAll(/^(tst-\d+) \|/gm)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      const lines: FlavorLine[] = ids.map((cardId) => ({
        cardId,
        flavorText: `A sentence for ${cardId}, long enough to pass.`,
      }));
      return Promise.resolve({
        value: { lines } as T,
        raw: JSON.stringify({ lines }),
        meta: {
          provider: 'anthropic-api',
          model: 'stub',
          usage: ZERO_USAGE,
          costUsd: 0,
          costSource: 'reported',
          attempts: 1,
          durationMs: 1,
        },
      });
    },
  };
  return { prompts, provider };
}

describe('the flavor pass over a set larger than one answer', () => {
  const cards = Array.from({ length: 130 }, (_, index) => roomy(`tst-${String(index).padStart(3, '0')}`));

  it('splits the set into batches the schema and the budget can both carry', async () => {
    const writer = lineWriter();
    const outcome = await writeFlavor({ provider: writer.provider, brief: BRIEF, cards });

    // 130 cards at 60 a batch: three calls, and every card got a line. Before
    // this the whole set went in one call against a schema capped at 120 lines,
    // so ten of these cards could not have been answered for at all.
    expect(writer.prompts).toHaveLength(3);
    expect(outcome.calls).toHaveLength(3);
    expect(outcome.lines).toHaveLength(cards.length);
    expect(new Set(outcome.lines.map((line) => line.cardId)).size).toBe(cards.length);
  });

  /**
   * What batching costs, and the mitigation that keeps it from costing it.
   *
   * `FLAVOR_SYSTEM` asks the writer to vary its register *across the set*, and a
   * batch that cannot see the other batches can only vary it across sixty cards.
   * So the lines already written go back in, the way the fill pass already feeds
   * a batch the names and cards printed before it.
   */
  it('shows each batch after the first what the earlier batches wrote', async () => {
    const writer = lineWriter();
    await writeFlavor({ provider: writer.provider, brief: BRIEF, cards });

    expect(writer.prompts[0]).not.toContain('<already_written>');
    expect(writer.prompts[1]).toContain('<already_written>');
    expect(writer.prompts[1]).toContain('A sentence for tst-000');
    expect(writer.prompts[2]).toContain('A sentence for tst-060');
  });

  it('says once that a run had no recorded fixture, not once a batch', async () => {
    const missing: LlmProvider = {
      name: 'fixture',
      model: 'stub',
      budget: unlimitedBudget(),
      complete<T>(): Promise<CompletionResult<T>> {
        return Promise.reject(new FixtureMissingError('abc123', '/fixtures/abc123.json'));
      },
    };
    const outcome = await writeFlavor({ provider: missing, brief: BRIEF, cards });

    expect(outcome.calls).toStrictEqual([]);
    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]).toContain('no fixture for key abc123');
    expect(outcome.notes[0]).toContain('further batch(es)');
  });

  it('keeps a set that fits in one call to one call', async () => {
    const writer = lineWriter();
    await writeFlavor({ provider: writer.provider, brief: BRIEF, cards: cards.slice(0, FLAVOR_BATCH_SIZE) });
    expect(writer.prompts).toHaveLength(1);
    expect(writer.prompts[0]).not.toContain('<already_written>');
  });
});

/**
 * The critique pass, and the diagnosis that turned out to be wrong.
 *
 * The reported problem was the 4,000-token answer budget: at 250 cards that is
 * about sixteen words a card. The recorded answer says otherwise. It came back
 * at 6,403 characters, which is nowhere near 4,000 tokens, and it hit every cap
 * the schema states — four paragraphs within 175 characters of an 800-character
 * limit, and exactly ten revisions against a limit of ten. The schema was the
 * binding constraint at 90 cards and would have stayed the binding constraint at
 * 250, so raising the token budget on its own would have bought nothing.
 */
describe('the critique budget', () => {
  it('hands a set at or under the base size the schema it always had', () => {
    expect(critiqueSchemaFor(CRITIQUE_BASE_SIZE)).toBe(CritiqueSchema);
    expect(critiqueSchemaFor(75)).toBe(CritiqueSchema);
    // The identity above is what preserves the fixture keys; this is the
    // property the identity is for, asserted where a reader will look for it.
    expect(toJsonSchema(critiqueSchemaFor(CRITIQUE_BASE_SIZE))).toStrictEqual(toJsonSchema(CritiqueSchema));
  });

  it('scales the caps with the set, and the allowance with the caps', () => {
    const base = critiqueBudget(CRITIQUE_BASE_SIZE);
    const large = critiqueBudget(250);
    expect(large.revisions).toBeGreaterThan(base.revisions);
    expect(large.proseChars).toBeGreaterThan(base.proseChars);
    expect(large.maxTokens).toBeGreaterThan(base.maxTokens);
    // Proportional to the set, so the review stays the same density of attention
    // per card rather than thinning out as the set grows.
    expect(large.revisions).toBe(Math.round((base.revisions * 250) / CRITIQUE_BASE_SIZE));
  });

  it('never shrinks a review below the base, whatever the set size', () => {
    for (const size of [0, 1, 20, 75, CRITIQUE_BASE_SIZE]) {
      expect(critiqueBudget(size)).toStrictEqual(critiqueBudget(CRITIQUE_BASE_SIZE));
    }
  });

  /** The caps are real on both sides: the wider schema takes what the base refuses. */
  it('accepts a review the base schema would refuse', () => {
    const large = critiqueBudget(250);
    const answer = {
      cohesion: 'c'.repeat(large.proseChars),
      archetypeSupport: 'a',
      flavorConsistency: 'f',
      powerOutliers: 'p',
      revisions: Array.from({ length: large.revisions }, (_, index) => ({
        slotId: `RW${String(index).padStart(2, '0')}`,
        category: 'powerLevel' as const,
        severity: 'major' as const,
        observation: 'over rate',
        instruction: 'raise the cost',
      })),
    };
    expect(critiqueSchemaFor(250).safeParse(answer).success).toBe(true);
    expect(CritiqueSchema.safeParse(answer).success).toBe(false);
  });
});
