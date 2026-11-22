/** Scenario observations prove only the selected cases, never complete card behavior. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ForgeScenarioStateSchema } from '@mtg/forge-export';
import { checkedProbeReport } from './printed-probe-report';

const Name = z.string().min(1);
const Identity = z.strictObject({ id: Name, ancestorTitles: z.array(Name), title: Name });
const Controller = z.enum(['local', 'engine']);
const Usage = z
  .array(
    z.strictObject({
      testFile: Name,
      testName: Name,
      testIdentity: Identity,
      runtime: z.unknown(),
      formatId: Name,
      controllers: z.tuple([Controller, Controller]),
      scenario: z.strictObject({
        state: ForgeScenarioStateSchema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        seed: Name,
        maximumTurns: z.number().int().positive(),
      }),
    }),
  )
  .min(1);
const Identities = z.object({
  testResults: z.array(
    z.object({
      name: Name,
      assertionResults: z.array(z.object({ fullName: Name, ancestorTitles: z.array(Name), title: Name })),
    }),
  ),
});
export interface ScenarioSelection {
  readonly testFile: string;
  readonly tests: readonly string[];
  readonly controller: 'local' | 'engine';
  readonly sourceName: string;
  readonly sourceSeat: 0 | 1;
  readonly decisionSeat?: 0 | 1;
}

/** Report text is a selection label; structured titles are the actual execution identity. */
export function checkedScenarioUsage(
  input: unknown,
  reportInput: unknown,
  selected: readonly ScenarioSelection[],
  runtime: unknown,
) {
  checkedProbeReport(reportInput, selected);
  const report = Identities.parse(reportInput);
  const rows = Usage.parse(input);
  const assertions = report.testResults.flatMap((file) =>
    file.assertionResults.map((assertion) => ({
      ...assertion,
      testFile: file.name,
    })),
  );
  if (
    rows.length !== assertions.length ||
    new Set(rows.map((row) => `${row.testFile}\0${row.testIdentity.id}`)).size !== rows.length
  )
    throw new Error('Scenario usage population mismatch');
  for (const assertion of assertions) {
    if ([...assertion.ancestorTitles, assertion.title].join(' ') !== assertion.fullName)
      throw new Error('Scenario report label disagrees with structured test identity');
    const matches = rows.filter(
      (row) =>
        row.testFile === assertion.testFile &&
        row.testIdentity.title === assertion.title &&
        isDeepStrictEqual(row.testIdentity.ancestorTitles, assertion.ancestorTitles),
    );
    if (matches.length !== 1) throw new Error('Missing or ambiguous scenario test identity');
    const row = matches[0]!;
    const claim = selected.find(
      (claim) => claim.testFile === assertion.testFile && claim.tests.includes(assertion.fullName),
    )!;
    if (
      !isDeepStrictEqual(row.runtime, runtime) ||
      row.controllers[claim.decisionSeat ?? claim.sourceSeat] !== claim.controller
    )
      throw new Error('Scenario runtime or source controller mismatch');
    const seat = row.scenario.state.seats[claim.sourceSeat];
    const zones = [
      ...seat.hand,
      ...seat.library,
      ...seat.battlefield,
      ...seat.graveyard,
      ...(seat.command ?? []),
    ];
    if (!zones.includes(claim.sourceName)) throw new Error('Scenario source absent from claimed seat');
    const digest = createHash('sha256').update(JSON.stringify(row.scenario.state)).digest('hex');
    if (digest !== row.scenario.sha256) throw new Error('Scenario state checksum mismatch');
  }
  return rows;
}
