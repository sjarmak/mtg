/**
 * Human-readable rendering of a build result.
 *
 * The deck builder is a heuristic, so its output has to be arguable: this
 * report shows the color-pair ranking that produced the choice, the curve it
 * hit against the curve it wanted, the mana split with its castability numbers,
 * and the score behind every pick.
 */
import { formatManaCost, isLand } from '@mtg/dsl';
import type { DeckBuildResult } from './build';
import { curveBucketLabel } from './curve-bucket';
import type { PoolCard } from './evaluate';
import { formatShortfalls } from './shortfall';

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pickLine(pick: PoolCard): string {
  const cost = isLand(pick.card) ? '—' : formatManaCost(pick.card.manaCost);
  const tags = [pick.isCreature ? 'creature' : pick.card.kind, pick.isRemoval ? 'removal' : undefined]
    .filter((tag): tag is string => tag !== undefined)
    .join(', ');
  return `  ${pick.score.toFixed(2).padStart(6)}  ${cost.padEnd(10)} ${pick.card.name} (${tags})`;
}

function curveLine(result: DeckBuildResult): string {
  return result.curve.slots
    .map((slot) => `${curveBucketLabel(slot.bucket)}:${slot.achieved}/${slot.target}`)
    .join('  ');
}

function manaLine(result: DeckBuildResult): string[] {
  return result.manaBase.reports.map((report) => {
    const earliest = report.earliest;
    const castability =
      earliest === undefined
        ? 'no demand'
        : `1 source by turn ${Math.max(1, earliest.manaValue)}: ${percent(report.earliestCastability)}` +
          (report.heaviest === undefined
            ? ''
            : `; ${report.heaviest.pips} by turn ${Math.max(1, report.heaviest.manaValue)}: ${percent(report.heaviestCastability)}`);
    return `  ${report.color}: ${report.sources} sources, ${report.pipCount} pips (${percent(report.demandShare)} of weighted demand) — ${castability}`;
  });
}

/** One-screen summary of a built deck. */
export function formatDeckReport(result: DeckBuildResult): string {
  const pairRanking = result.colorPairs
    .slice(0, 3)
    .map(
      (pair) =>
        `${pair.key} ${pair.topScore.toFixed(1)} (${pair.playableCount} playable, ${pair.removalCount} answers)`,
    )
    .join('  |  ');

  return [
    `Deck: ${result.deck.length} cards — ${result.spells.length} spells, ${result.lands.length} lands`,
    `Colors: ${result.colorPair.join('')} — top pairs: ${pairRanking}`,
    `Creatures: ${result.creatureCount}  Removal: ${result.removalCount}`,
    `Curve (achieved/target): ${curveLine(result)}`,
    `Curve mass MV 2-4: ${result.curve.massTwoToFour}  MV 5+: ${result.curve.topEnd}`,
    'Mana base:',
    ...manaLine(result),
    `Shortfalls: ${formatShortfalls(result.shortfalls)}`,
    'Picks:',
    ...result.picks.map(pickLine),
  ].join('\n');
}
