/**
 * Stage 1 — mechanics prompt to an enforceable set.
 *
 * The whole point of the co-design invariant is asserted here rather than
 * assumed: the stage fails unless every slot printed a card and every printed
 * card passes `validateCard` with zero violations. A set that generated 88 of
 * 90 cards is not a set the rest of the loop is allowed to see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '@mtg/dsl';
import { validateCard, validateSetUniqueness } from '@mtg/dsl';
import type { LlmProvider } from '@mtg/llm';
import { createBudgetGuard, resolveProvider } from '@mtg/llm';
import type { GenerationReport, SetBrief } from '@mtg/setgen';
import { formatReport, generateSet, parseBrief, writeSetOutput } from '@mtg/setgen';
import { failStage } from '../errors';
import type { SliceOptions } from '../options';

export interface SetgenStageResult {
  readonly brief: SetBrief;
  readonly cards: readonly Card[];
  readonly report: GenerationReport;
  readonly reportText: string;
  readonly setPath: string;
  readonly reportPath: string;
  readonly slotsPath: string;
}

function readBrief(path: string): SetBrief {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    failStage('setgen', `cannot read the brief at ${path}`, error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    failStage('setgen', `the brief at ${path} is not valid JSON`, error);
  }
  try {
    return parseBrief(parsed);
  } catch (error: unknown) {
    failStage('setgen', `the brief at ${path} is not a valid set brief`, error);
  }
}

/** The provider the run was asked for, wired with a spend ceiling if one was given. */
export function buildProvider(options: SliceOptions): LlmProvider {
  return resolveProvider({
    provider: options.provider,
    fixture: { dir: options.fixtureDir, record: false },
    ...(options.maxUsd === null ? {} : { budget: createBudgetGuard({ maxUsd: options.maxUsd }) }),
  });
}

export async function runSetgenStage(options: SliceOptions): Promise<SetgenStageResult> {
  const brief = readBrief(options.briefPath);
  const provider = buildProvider(options);

  const result = await generateSet({ provider, brief, critique: options.critique });
  const { cards, report } = result;

  if (cards.length !== brief.targetSize) {
    failStage(
      'setgen',
      `the brief asked for ${brief.targetSize} cards and the generator printed ${cards.length}` +
        `; ${report.slots - report.cardsPrinted} slot(s) never produced a usable card`,
    );
  }

  const illegal = cards.filter((card) => validateCard(card).length > 0);
  if (illegal.length > 0) {
    const names = illegal.slice(0, 5).map((card) => card.name);
    failStage(
      'setgen',
      `${illegal.length} printed card(s) do not pass the DSL validators, so the engine cannot run them: ${names.join(', ')}`,
    );
  }

  const duplicates = validateSetUniqueness(cards);
  if (duplicates.length > 0) {
    failStage(
      'setgen',
      `the set contains ${duplicates.length} uniqueness violation(s): ${duplicates[0]?.message ?? ''}`,
    );
  }

  if (!report.enforceable) {
    const errors = report.findings.filter((finding) => finding.severity === 'error');
    failStage(
      'setgen',
      `the generated set is not enforceable: ${errors.length} error finding(s), first: ` +
        `${errors[0]?.code ?? 'unknown'} — ${errors[0]?.message ?? 'no message'}`,
    );
  }

  const paths = writeSetOutput(join(options.outDir, 'set'), result);
  return {
    brief,
    cards,
    report,
    reportText: formatReport(report),
    setPath: paths.setPath,
    reportPath: paths.reportPath,
    slotsPath: paths.slotsPath,
  };
}
