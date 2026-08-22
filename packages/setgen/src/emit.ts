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
import { CardSchema, serializeCards } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
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

/** Parses a set file from disk; throws with the schema issues on bad input. */
export function parseSetFile(input: unknown): SetFile {
  return SetFileSchema.parse(input);
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
