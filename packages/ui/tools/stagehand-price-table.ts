/**
 * Per-token USD pricing for the one call on the Stagehand path (`--max-usd`)
 * that reports no dollars of its own: Jev's `evaluate`. Jev answers with token
 * counts only, so its cost is those counts times a figure read from the
 * vendor's published pricing, not read off a response.
 *
 * The `observe()` model call is not here. It goes through `@mtg/llm`
 * (`stagehand-model-bridge.ts`), whose `claude-cli` transport reports each
 * call's dollars from the binary itself (`mtg-onjme.2`).
 *
 * A model the meter is asked to price and finds no entry for is refused, not
 * charged zero: a silent free call would let a run overshoot `--max-usd`
 * without anything having priced it.
 */

export interface ModelPrice {
  readonly modelId: string;
  readonly inputUsdPerToken: number;
  readonly outputUsdPerToken: number;
  /** Where the figure was read, so it can be re-checked rather than trusted. */
  readonly source: string;
  readonly readAt: string;
}

const PRICE_TABLE: readonly ModelPrice[] = [
  {
    // The direct API's model alias (`jev-client.ts`'s `JEV_DIRECT_MODEL`),
    // $0.042 per million input tokens, output free.
    modelId: 'jev-latest',
    inputUsdPerToken: 0.042 / 1_000_000,
    outputUsdPerToken: 0,
    source: 'https://docs.typesafe.ai/models.md',
    readAt: '2026-09-22',
  },
];

/** Named so a refusal reads as "nobody priced this call" rather than a generic lookup miss. */
export class UnpricedModelError extends Error {
  constructor(readonly modelId: string) {
    super(
      `no price entry for model ${JSON.stringify(modelId)}; the meter refuses to charge an unpriced call`,
    );
    this.name = 'UnpricedModelError';
  }
}

export function priceOf(modelId: string): ModelPrice {
  const found = PRICE_TABLE.find((entry) => entry.modelId === modelId);
  if (found === undefined) throw new UnpricedModelError(modelId);
  return found;
}
