/**
 * The cube as something a designer can read and argue with.
 *
 * `validate.ts` produces the numbers and this file is the only thing that turns
 * them into prose, which is the split that keeps the measurement honest: a
 * finding carries `measured` and `required` so a caller can rank or chart it,
 * and the sentence a person reads is assembled here from those same two
 * numbers rather than written independently and left to drift.
 *
 * Everything measured is printed, including the parts nothing fails on. A cube
 * that states no curve still has one, and its land and colorless counts are
 * the first two dials a designer reaches for; leaving them out of the report
 * because no criterion names them would hide the shape of the list behind the
 * subset of it somebody happened to constrain.
 */
import { assertNever } from '@mtg/dsl';
import type { CubeAvailability } from './availability';
import type { ConstructedCube, ConstructionStop } from './construct';
import { draftCapacity } from './criteria';
import type { CubeFinding, CubeMeasurement } from './validate';

export function formatCubeReport(cube: ConstructedCube): string {
  const { criteria, validation } = cube;
  const lines: string[] = [
    `# Cube: ${criteria.prompt}`,
    '',
    `Format ${criteria.format} · ${String(validation.measurement.size)} of ${String(criteria.size)} cards · ` +
      `${criteria.singleton ? 'singleton' : 'up to four copies'}`,
    `Chosen from ${String(cube.poolSize)} cards the criteria allow, in ${plural(cube.rounds, 'round')}.`,
    `A ${String(criteria.seats)}-seat pod at ${String(criteria.cardsPerSeat)} cards each consumes ${String(draftCapacity(criteria))}.`,
    stopLine(cube.stop, cube.shortBy),
  ];

  if (cube.plan !== '') lines.push('', '## Plan', '', cube.plan);
  lines.push('', ...shapeSection(validation.measurement));
  lines.push('', ...archetypeSection(validation.measurement));
  lines.push('', ...availabilitySection(validation.availability));
  lines.push('', ...findingSection(validation.findings));
  lines.push('', ...rejectionSection(cube));
  lines.push('', ...cardSection(cube));
  return `${lines.join('\n')}\n`;
}

/** Which bound ended the loop, phrased as what a designer should do next. */
function stopLine(stop: ConstructionStop, shortBy: number): string {
  switch (stop.kind) {
    case 'filled':
      return 'Filled to its stated size.';
    case 'stalled':
      return `${plural(shortBy, 'card')} short: a whole round was rejected, so the loop stopped rather than spend another. The unresolved proposals are below.`;
    case 'rounds':
      return `${plural(shortBy, 'card')} short: the ${String(stop.limit)}-round budget ran out. Raise it to keep going.`;
    case 'spend':
      return (
        `${plural(shortBy, 'card')} short: the construction reached the $${stop.limit.toFixed(2)} it was allowed ` +
        `to spend on model calls, at $${stop.spentUsd.toFixed(2)}. Raise --max-spend-usd to keep going.`
      );
    default:
      return assertNever(stop, 'construction stop');
  }
}

function shapeSection(measurement: CubeMeasurement): readonly string[] {
  const curve =
    measurement.curve.length === 0
      ? 'no non-land cards'
      : measurement.curve.map((point) => `MV ${String(point.manaValue)}: ${String(point.cards)}`).join(' · ');
  const slots = measurement.colors.reduce((sum, color) => sum + color.cards, 0);

  return [
    '## Shape',
    '',
    ...measurement.colors.map(
      (color) =>
        `- ${color.color} — ${String(color.cards)} of ${String(slots)} colored slots (${percent(color.share)})`,
    ),
    `- lands ${String(measurement.lands)} · colorless ${String(measurement.colorless)}`,
    '',
    `Curve: ${curve}`,
  ];
}

function archetypeSection(measurement: CubeMeasurement): readonly string[] {
  if (measurement.archetypes.length === 0) {
    return ['## Archetypes', '', 'None stated, so none measured.'];
  }
  return [
    '## Archetypes',
    '',
    ...measurement.archetypes.map(
      (archetype) =>
        `- ${archetype.name} — ${String(archetype.playable)} playable of ${String(archetype.required)} required`,
    ),
  ];
}

/**
 * What drafting the list said, with the seed, the sample and the deal beside it.
 *
 * A share with no sample and no seed is a number a reader has to take on trust,
 * so the header line carries both: 25 drafts of an 8-seat pod is 200 seat-drafts
 * under a named seed, and rerunning it produces this page again.
 *
 * A share with no deal beside it is worse than untrustworthy, it is ambiguous.
 * The share falls as the cube's color count rises whatever the list holds, so
 * each archetype prints how many cards it can play, how many of those this pod
 * deals a seat before a pick, and what a deck needs — the three numbers that
 * separate a thin archetype from a pod too shallow to field any archetype in a
 * list this wide. `availability.ts`'s header carries the measurements.
 */
function availabilitySection(availability: CubeAvailability | null): readonly string[] {
  if (availability === null) return ['## Availability', '', 'Not measured.'];
  if (availability.kind === 'unmeasured') {
    return ['## Availability', '', `Not drafted: ${availability.reason}.`];
  }
  return [
    '## Availability',
    '',
    `${plural(availability.drafts, 'seeded draft')} of ${String(availability.seats)} seats at ` +
      `${String(availability.cardsPerSeat)} cards each — ${String(availability.seatDrafts)} seat-drafts, seed \`${availability.seed}\`.`,
    `A deck needs ${plural(availability.spellsRequired, 'spell')}; each archetype's deal below is what one seat is ` +
      'handed before a single pick, so a deal under that is a pod too shallow for this list rather than a thin archetype.',
    '',
    ...availability.archetypes.map((archetype) => {
      const held =
        archetype.minShare === null ? 'no minimum stated' : `minimum ${percent(archetype.minShare)}`;
      return (
        `- ${archetype.name} — ${String(archetype.assembled)} of ${String(availability.seatDrafts)} ` +
        `seat-drafts could assemble it (${percent(archetype.share)}), ${held}; ` +
        `${String(archetype.castable)} castable spells in the cube, ${archetype.dealtCastable.toFixed(1)} dealt per seat`
      );
    }),
  ];
}

function findingSection(findings: readonly CubeFinding[]): readonly string[] {
  if (findings.length === 0) {
    return ['## Findings', '', 'None: the cube meets every criterion it was given.'];
  }
  return [
    '## Findings',
    '',
    ...findings.map((finding: CubeFinding) => `- \`${finding.code}\` ${finding.detail}`),
  ];
}

/**
 * What the last round asked for and did not get. Printed because a short cube
 * is repaired by answering these, not by rerunning the same ask.
 */
function rejectionSection(cube: ConstructedCube): readonly string[] {
  if (cube.rejections.length === 0) return ['## Unresolved proposals', '', 'None.'];
  return [
    '## Unresolved proposals',
    '',
    ...cube.rejections.map((rejection) => `- \`${rejection.code}\` ${rejection.detail}`),
  ];
}

function cardSection(cube: ConstructedCube): readonly string[] {
  return [
    '## Cards',
    '',
    ...[...cube.entries]
      .sort((a, b) => a.card.name.localeCompare(b.card.name))
      .map((entry) => {
        const tags = entry.archetypes.length === 0 ? 'untagged' : entry.archetypes.join(', ');
        return `- **${String(entry.count)}x ${entry.card.name}** (${tags}) — ${entry.reason}`;
      }),
  ];
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
