/** Accept only complete selected-test results, never a green aggregate with missing assertions. */
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';

const Report = z.object({
  success: z.literal(true),
  numTotalTests: z.number().int().positive(),
  numPassedTests: z.number().int().positive(),
  numFailedTests: z.literal(0),
  numPendingTests: z.literal(0),
  numTodoTests: z.literal(0),
  testResults: z
    .array(
      z.object({
        name: z.string(),
        status: z.literal('passed'),
        assertionResults: z
          .array(
            z.object({
              fullName: z.string(),
              status: z.literal('passed'),
              failureMessages: z.array(z.never()),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

const Usage = z
  .array(
    z.strictObject({
      testFile: z.string().min(1),
      testName: z.string().min(1),
      runtime: z.unknown(),
      formatId: z.string().min(1),
      controllers: z.array(z.enum(['local', 'engine'])).min(1),
    }),
  )
  .min(1);

/** A file executes once; each assertion belongs to exactly one receipt claim. */
export function groupedProbeFiles(
  selected: readonly { readonly testFile: string; readonly tests: readonly string[] }[],
) {
  if (selected.length === 0 || selected.some((entry) => entry.tests.length === 0))
    throw new Error('Probe selection must contain assertions');
  return [...new Set(selected.map((entry) => entry.testFile))].map((testFile) => {
    const tests = selected.filter((entry) => entry.testFile === testFile).flatMap((entry) => entry.tests);
    if (new Set(tests).size !== tests.length)
      throw new Error(`Overlapping probe assertion claims: ${testFile}`);
    return { testFile, tests };
  });
}

export function checkedProbeUsage(
  input: unknown,
  selected: readonly {
    readonly testFile: string;
    readonly tests: readonly string[];
    readonly controller?: 'local' | 'engine';
  }[],
  runtime: unknown,
  formatId: string,
): void {
  groupedProbeFiles(selected);
  const parsed = Usage.safeParse(input);
  if (!parsed.success) throw new Error('Invalid snapshot usage', { cause: parsed.error });
  const rows = parsed.data;
  for (const row of rows) {
    const file = selected.find((file) => file.testFile === row.testFile && file.tests.includes(row.testName));
    if (
      file === undefined ||
      !isDeepStrictEqual(row.runtime, runtime) ||
      row.formatId !== formatId ||
      (file.controller !== undefined && !row.controllers.includes(file.controller))
    )
      throw new Error('Mismatched snapshot usage');
  }
  for (const file of selected)
    for (const name of file.tests)
      if (!rows.some((row) => row.testFile === file.testFile && row.testName === name))
        throw new Error(`Missing snapshot usage: ${file.testFile} / ${name}`);
}

export function checkedProbeReport(
  input: unknown,
  selected: readonly { readonly testFile: string; readonly tests: readonly string[] }[],
): void {
  const files = groupedProbeFiles(selected);
  const report = Report.parse(input);
  const count = files.reduce((sum, file) => sum + file.tests.length, 0);
  if (
    report.numTotalTests !== count ||
    report.numPassedTests !== count ||
    report.testResults.length !== files.length
  )
    throw new Error('Probe report test population mismatch');
  for (const file of files) {
    const matches = report.testResults.filter((result) => result.name === file.testFile);
    const actual = matches[0]?.assertionResults.map((result) => result.fullName) ?? [];
    if (
      matches.length !== 1 ||
      actual.length !== file.tests.length ||
      new Set(actual).size !== actual.length ||
      new Set(file.tests).size !== file.tests.length ||
      !file.tests.every((name) => actual.includes(name))
    )
      throw new Error(`Probe report assertion population mismatch: ${file.testFile}`);
  }
}
