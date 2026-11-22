/**
 * Emission: the set file and the generation report on disk.
 *
 * The set file carries no timestamp and no machine-specific data, so two runs
 * of the same brief and seed against the same recorded responses produce
 * byte-identical files. That is what makes a generated set reviewable as a diff.
 * The report is a sibling file rather than a section of the set, because the set
 * is consumed by the engine and the report is consumed by a human.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CardSchema, CardValidationError, serializeCards, validateCardRecord } from '@mtg/dsl';
import type { Card, Violation } from '@mtg/dsl';
import type { GenerationResult } from './generate';
import type { GenerationReport } from './report';

export const SET_FILE_VERSION = 1;

export const SetFileSchema = z.object({
  formatVersion: z.literal(SET_FILE_VERSION),
  set: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    theme: z.string().min(1),
    seed: z.string().min(1),
    profile: z.string().min(1),
  }),
  cards: z.array(CardSchema),
});

export type SetFile = z.infer<typeof SetFileSchema>;

export function buildSetFile(result: GenerationResult): SetFile {
  const { brief, profile } = result.allocation;
  return {
    formatVersion: SET_FILE_VERSION,
    set: {
      code: brief.setCode,
      name: brief.setName,
      theme: brief.theme,
      seed: brief.seed,
      profile: `${profile.profile} v${profile.version}`,
    },
    cards: [...result.cards],
  };
}

/**
 * Parses a set file from disk; throws with the schema issues on bad input.
 *
 * Two doors, and for a long time only the first one was here. `SetFileSchema`
 * is `z.array(CardSchema)` over the cards, which is the shape check; the
 * structural checks live in `validateCardRecord` and were reachable only
 * through `parseCard` / `parseCards`. One of them is `checkOracleText`: a
 * cached `oracleText` must equal what the abilities under it render to. So a
 * set file could carry a cached sentence that disagreed with its own card and
 * this function accepted it (`mtg-6lny`).
 *
 * That matters because `parseSetFile` is what the surfaces read a set through:
 * the play launcher, the art pipeline's plan, subjects and verify, the brief-drift
 * triage, half the fixture tests. A card face prints `card.oracleText`
 * directly, and an art brief written from `subjectSource` renders it fresh, so
 * a stale cache means the picture was bought from one sentence and the card
 * prints another. The break of 2026-08-27 is the precedent: a shortened print
 * template left eleven cached strings stale in the flagship fixture, and what
 * caught it was a precon test that happens to read the fixture through
 * `parseCards` for an unrelated reason.
 *
 * It refuses rather than repairs. Repairing would leave the file on disk and
 * the set in memory disagreeing, which is the same failure one layer along, and
 * a refusal asks for the regeneration that fixes the file for every reader at
 * once. Measured before this became strict: all three committed set fixtures
 * pass, as do the reduced M11, M13 and RTR reference sets and the slice set.
 * What it newly refuses is stale build output under `out/` — untracked, and a
 * candidate the launcher already drops rather than serving.
 */
export function parseSetFile(input: unknown): SetFile {
  const file = SetFileSchema.parse(input);
  const illegal = file.cards
    .map((card, index) => locate(card, index))
    .filter((violations) => violations.length > 0);
  if (illegal.length > 0) {
    throw new CardValidationError(
      illegal.flat(),
      `set ${file.set.code} carries ${String(illegal.length)} card(s) the DSL refuses`,
    );
  }
  return file;
}

/** One card's violations, repathed from the card's root to the set file's. */
function locate(card: Card, index: number): readonly Violation[] {
  return validateCardRecord(card).map((one) => ({
    ...one,
    path: `cards[${String(index)}] ${card.id}${one.path.length > 0 ? `.${one.path}` : ''}`,
  }));
}

export interface EmittedPaths {
  readonly setPath: string;
  readonly reportPath: string;
  readonly slotsPath: string;
}

/** Writes `set.json`, `report.json` and `slots.json` into `dir`, creating it. */
export function writeSetOutput(dir: string, result: GenerationResult): EmittedPaths {
  mkdirSync(dir, { recursive: true });
  const setPath = join(dir, 'set.json');
  const reportPath = join(dir, 'report.json');
  const slotsPath = join(dir, 'slots.json');
  writeFileSync(setPath, `${JSON.stringify(buildSetFile(result), null, 2)}\n`, 'utf8');
  writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');
  writeFileSync(slotsPath, `${JSON.stringify(result.allocation.slots, null, 2)}\n`, 'utf8');
  return { setPath, reportPath, slotsPath };
}

/** The set's cards as a standalone DSL card list, for engine consumers. */
export function serializeSetCards(cards: readonly Card[]): string {
  return serializeCards(cards);
}

/** Report as JSON text; the same bytes `writeSetOutput` puts on disk. */
export function serializeReport(report: GenerationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
