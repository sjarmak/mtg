/**
 * Stage 6 — the Forge conformance gate.
 *
 * Three outcomes, and the middle one is the point: `passed` means a real Forge
 * loaded every card and played a game; `failed` means the set contains a
 * construct the 15-year-hardened oracle rejects; `skipped` means the gate did
 * not run and says why. A skip is never reported as a pass — the summary
 * carries the status verbatim so a green run with no Forge on the box reads as
 * "conformance unproven", not "conformance fine".
 *
 * Transpile rejections fail even when Forge is absent. An unmappable construct
 * is a defect in the set whether or not an engine is installed to notice.
 */
import type { Card } from '@mtg/dsl';
import type { BootGateStatus } from '@mtg/forge-export';
import { bootGate, formatRejections } from '@mtg/forge-export';
import { failStage } from '../errors';

export interface ForgeStageResult {
  readonly status: BootGateStatus;
  readonly reason: string;
  /** True when the gate was skipped by request rather than by a missing engine. */
  readonly skippedByRequest: boolean;
  readonly cardCount: number;
  readonly forgeVersion: string | null;
  readonly gamesPlayed: number;
  readonly problemCards: readonly string[];
  readonly commands: readonly string[];
  readonly durationMs: number;
}

export interface ForgeStageOptions {
  readonly skip: boolean;
  readonly forgeHome: string | null;
}

export async function runForgeStage(
  cards: readonly Card[],
  options: ForgeStageOptions,
): Promise<ForgeStageResult> {
  if (options.skip) {
    return {
      status: 'skipped',
      reason: 'skipped by --skip-forge; conformance against the Forge oracle is unproven for this run',
      skippedByRequest: true,
      cardCount: cards.length,
      forgeVersion: null,
      gamesPlayed: 0,
      problemCards: [],
      commands: [],
      durationMs: 0,
    };
  }

  const result = await bootGate(cards, {
    ...(options.forgeHome === null ? {} : { forgeHome: options.forgeHome }),
  });

  if (result.status === 'failed') {
    const detail = result.rejections.length > 0 ? `\n${formatRejections(result.rejections)}` : '';
    failStage('forge', `${result.reason}${detail}`);
  }

  return {
    status: result.status,
    reason: result.reason,
    skippedByRequest: false,
    cardCount: result.cardCount,
    forgeVersion: result.forgeVersion,
    gamesPlayed: result.games.reduce((sum, game) => sum + game.gamesPlayed, 0),
    problemCards: result.problemCards,
    commands: result.commands,
    durationMs: result.durationMs,
  };
}
