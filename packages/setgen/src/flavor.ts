/**
 * The flavor-text pass: a batch of model calls over the finished, legal set.
 *
 * Flavor text is prose about a world, so it is the model's to write and none of
 * it is the code's (ZFC). What code owns here is the same as everywhere else in
 * this package: the schema the answer must satisfy, the bound on its length, and
 * the refusal of anything the card face could not draw.
 *
 * # Why it is a pass of its own rather than a field on the fill schema
 *
 * `@mtg/llm` keys a recorded fixture on `hash(system, prompt, schema)`, so
 * adding one property to `FilledCardSchema` renames **every** fixture under
 * `fixtures/llm-hearthglass/` and `fixtures/llm/` and orphans all of them. The
 * only way back would be re-recording against a live provider, which costs
 * money. A separate call leaves every existing key byte-identical, and it is
 * also the better shape on its own terms: flavor text is written about a
 * finished card, and the fill pass does not know yet what the card will be.
 *
 * # It runs last, and it runs after validation
 *
 * The prompt shows each card as its printed face, so the writer is looking at
 * the card a player will hold. Nothing it returns can make a set illegal:
 * `flavorText` is outside `renderOracleText`, outside the card's fingerprint and
 * outside every structural validator except `checkFlavorText`, which only bounds
 * its shape. A card whose flavor text fails that check keeps the card and loses
 * the sentence.
 *
 * # A run that cannot reach a writer produces a set with no flavor text
 *
 * Which is a normal set: every set committed to this repository is one, the
 * field is optional, and `@mtg/ui`'s `textBoxBlocks` simply omits the block. So
 * a schema the writer could not satisfy and a fixture that was never recorded
 * both leave the run standing and say why in the record, the way `critique.ts`
 * already treats a reviewer that produced nothing usable. The two are recorded
 * differently and `FlavorOutcome` says why. Every other failure still
 * propagates: a set generator that swallowed a budget error would be hiding a
 * real fault behind an optional feature.
 */
import { z } from 'zod';
import type { Card } from '@mtg/dsl';
import { FLAVOR_TEXT_MAX_LENGTH, hasViolation, validateCard } from '@mtg/dsl';
import type { LlmProvider } from '@mtg/llm';
import { isLlmError, ZERO_USAGE } from '@mtg/llm';
import { RULES_FIT_STEPS, rulesFitStepOf } from '@mtg/card-geometry';
import type { SetBrief } from './brief';
import type { CallRecord } from './fill';
import { chunk } from './fill';
import { buildFlavorPrompt, FLAVOR_SYSTEM } from './prompts';

/**
 * How much of the fit ladder a card's rules text may already need and still be
 * offered for flavor text, as a share of `RULES_FIT_STEPS`.
 *
 * The playtester asked for flavor text "for the cards that have more text space
 * available for it", so the prompt is shown the cards that have room rather than
 * shown every card and asked to judge. `@mtg/ui`'s ladder no longer counts
 * lines — `anatomy.ts` costs a box in CSS pixels against an 87px budget and
 * states which of the four rungs of `RULES_FIT_STEPS` a run of text needs to fit
 * — so the line drawn here is a rung rather than a fraction of 4.4: a card whose
 * own rules text already needs the bottom half of the ladder has room for
 * nothing else. The renderer makes the same decision again and exactly
 * (`composeTextBox`), because it knows the composed card and the real flavor
 * block; this is the cheaper version of it, asked of the bare oracle string
 * before either exists, used only to decide what to put in front of the writer.
 */
export const FLAVOR_ROOM_SHARE = 1 / 2;

export const FlavorLineSchema = z.object({
  cardId: z.string().min(1),
  /**
   * One sentence or two of prose. The upper bound is the DSL's own
   * (`FLAVOR_TEXT_MAX_LENGTH`), restated here so the model is refused at the
   * schema rather than at the validator; the lower bound is a real sentence
   * rather than a word.
   */
  flavorText: z.string().min(12).max(FLAVOR_TEXT_MAX_LENGTH),
});

export const FlavorSchema = z.object({
  lines: z.array(FlavorLineSchema).max(120).default([]),
});

export type FlavorLine = z.infer<typeof FlavorLineSchema>;

export const DEFAULT_FLAVOR_MAX_TOKENS = 6000;

/**
 * How many cards one flavor call is shown.
 *
 * The pass used to send the whole set in one call, and the two numbers it did
 * that with were sized against each other and against a 90-card slice: a schema
 * capped at 120 lines, and a 6,000-token answer. Neither reaches 250 cards. The
 * schema cap is the loud half — a 250-card set has more cards with room in the
 * box than the answer may carry lines, so the writer is refused by its own
 * schema — and the budget is the quiet half, because 120 lines at 6,000 tokens
 * is about 50 tokens a line and a line is an id plus up to 160 characters. A set
 * of long lines therefore ran out of answer before it ran out of cards, and the
 * failure would have looked like a set that is mostly bare.
 *
 * Sixty is the batch, which is the schema's own cap halved so the budget stops
 * being the binding number: sixty lines at 6,000 tokens is about 100 tokens a
 * line, which is twice what the longest legal line costs. The schema keeps its
 * 120 so a batch can never be the thing that overflows it.
 */
export const FLAVOR_BATCH_SIZE = 60;

export interface FlavorRequest {
  readonly provider: LlmProvider;
  readonly brief: SetBrief;
  /** The finished cards, in collector-number order. */
  readonly cards: readonly Card[];
  readonly maxTokens?: number;
}

/**
 * What the pass produced, and the two different ways it can produce nothing.
 *
 * A `CallRecord` is added for every request that actually reached the transport,
 * whether or not it came back usable — that is a call the run spent something on
 * and the usage rollup has to see it. A note is added when no request was sent
 * at all: no card had room, or the fixture provider had nothing recorded for the
 * key. Recording that as a zero-cost `CallRecord` would be the wrong shape twice
 * over. It would push `usage.calls` up by one for a call nobody made, and it
 * would have to name a `costSource` — and `'unknown'` there means "we do not
 * know what this cost", which drags a whole run's provenance down from
 * `reported` on a call that provably cost zero.
 *
 * Both are lists because the pass is batched. A run with no recorded fixtures
 * misses every batch for one reason, so those are collapsed into a single note
 * that says how many: a report with four lines saying the same thing is a report
 * nobody finishes reading.
 */
export interface FlavorOutcome {
  readonly lines: readonly FlavorLine[];
  readonly calls: readonly CallRecord[];
  /** Why nothing was written, wherever nothing was asked or nothing came back. */
  readonly notes: readonly string[];
}

/**
 * How much room a card's rules text leaves in the box, as a share of
 * `RULES_FIT_STEPS` rather than of a line count.
 *
 * `rulesFitStepOf` is `@mtg/ui`'s own entry point for exactly this question
 * asked of a bare oracle string — no reminders, no flavor block, because those
 * are decisions only a composed `Card` can make and this function is asked
 * before one exists. It returns which rung of the ladder the string needs; this
 * turns the rung into a share so the threshold above still reads as a fraction:
 * 1 at the top of the ladder (no shrinking needed), 0 at the floor.
 *
 * A deliberately coarse estimate, because all it decides is whether a card is
 * shown to the writer — `composeTextBox` makes the real decision, over the real
 * card and the real flavor line, once both exist.
 */
export function flavorRoom(oracleText: string): number {
  const floor = RULES_FIT_STEPS.length - 1;
  return 1 - rulesFitStepOf(oracleText) / floor;
}

/** The cards with room in the box for a sentence of flavor text. */
export function cardsWithRoom(cards: readonly Card[]): readonly Card[] {
  return cards.filter((card) => flavorRoom(card.oracleText ?? '') >= 1 - FLAVOR_ROOM_SHARE);
}

/**
 * The cards a run should carry, with the flavor text the writer returned.
 *
 * A line naming a card the set does not contain is dropped, and so is a line
 * whose text the DSL refuses — that is `checkFlavorText`, run here against the
 * card it would be attached to rather than trusted from the schema, so the
 * printed set can never carry a string `validateCard` would fail.
 *
 * `FLAVOR_TEXT_INVALID` and nothing else. The whole card is validated because
 * that is the one entry point, but only the flavor code may cost a card its
 * sentence: this pass runs after the set is legal, and a card carrying some
 * unrelated violation is a fault for the caller to see rather than a reason to
 * silently drop prose that is fine.
 */
export function applyFlavor(cards: readonly Card[], lines: readonly FlavorLine[]): readonly Card[] {
  const byId = new Map(lines.map((line) => [line.cardId, line.flavorText]));
  return cards.map((card) => {
    const flavorText = byId.get(card.id);
    if (flavorText === undefined) return card;
    const flavored: Card = { ...card, flavorText };
    return hasViolation(validateCard(flavored), 'FLAVOR_TEXT_INVALID') ? card : flavored;
  });
}

/**
 * One batch of eligible cards, written against the lines already written.
 *
 * The lines so far are shown to the writer for one reason: `FLAVOR_SYSTEM` asks
 * it to vary the register *across the set*, and a batch that cannot see the
 * other batches can only vary it across itself. Feeding the written lines back
 * is the same move the fill pass already makes with the names and cards printed
 * before a batch, and it is bounded the same way — by the set, which the brief
 * caps.
 */
async function writeBatch(
  request: FlavorRequest,
  cards: readonly Card[],
  written: readonly FlavorLine[],
): Promise<FlavorOutcome> {
  const started = Date.now();
  try {
    const result = await request.provider.complete({
      system: FLAVOR_SYSTEM,
      prompt: buildFlavorPrompt({ brief: request.brief, cards, written }),
      schema: FlavorSchema,
      maxTokens: request.maxTokens ?? DEFAULT_FLAVOR_MAX_TOKENS,
    });
    return {
      lines: result.value.lines,
      notes: [],
      calls: [
        {
          purpose: 'flavor',
          round: 0,
          slotIds: [],
          provider: result.meta.provider,
          model: result.meta.model,
          attempts: result.meta.attempts,
          durationMs: result.meta.durationMs,
          usage: result.meta.usage,
          costUsd: result.meta.costUsd,
          costSource: result.meta.costSource,
        },
      ],
    };
  } catch (error: unknown) {
    // "No answer is available" rather than "the machine is broken": a schema the
    // writer could not satisfy, and a fixture that was never recorded. Anything
    // else — a budget, a transport, a refusal — is a real fault and propagates.
    if (!isLlmError(error)) throw error;
    // Nothing was sent, so nothing was spent and there is no call to record.
    // This is every run in this repository: the pass has no recorded fixture and
    // recording one needs a live provider.
    if (error.code === 'fixture_missing') {
      return { lines: [], calls: [], notes: [`no flavor text: ${error.message}`] };
    }
    // A request that did reach the transport and burned tokens for an answer
    // nothing could parse. That is a call, and the rollup has to see it; the
    // meta is gone with the answer, so the cost is genuinely unknown.
    if (error.code !== 'schema_validation') throw error;
    return {
      lines: [],
      notes: [],
      calls: [
        {
          purpose: 'flavor',
          round: 0,
          slotIds: [],
          provider: request.provider.name,
          model: request.provider.model,
          attempts: 0,
          durationMs: Date.now() - started,
          usage: ZERO_USAGE,
          costUsd: 0,
          costSource: 'unknown',
          error: error.message,
        },
      ],
    };
  }
}

/**
 * Every batch that came back with nothing recorded, said once.
 *
 * A run with no recorded fixture for this pass misses every batch, and every
 * miss carries a different key in its message. Four notes with four keys and one
 * cause is noise in a report that a person reads to the end; one note that says
 * how many and shows the first is the same information.
 */
function collapseMissing(notes: readonly string[]): readonly string[] {
  const [first] = notes;
  if (notes.length <= 1 || first === undefined) return notes;
  return [`${first} (and ${String(notes.length - 1)} further batch(es), same cause)`];
}

export async function writeFlavor(request: FlavorRequest): Promise<FlavorOutcome> {
  const eligible = cardsWithRoom(request.cards);
  if (eligible.length === 0) {
    return {
      lines: [],
      calls: [],
      notes: ['no flavor text: no card in the set has room in its text box for a line'],
    };
  }

  const lines: FlavorLine[] = [];
  const calls: CallRecord[] = [];
  const notes: string[] = [];
  for (const batch of chunk(eligible, FLAVOR_BATCH_SIZE)) {
    const outcome = await writeBatch(request, batch, lines);
    lines.push(...outcome.lines);
    calls.push(...outcome.calls);
    notes.push(...outcome.notes);
  }
  return { lines, calls, notes: collapseMissing(notes) };
}
