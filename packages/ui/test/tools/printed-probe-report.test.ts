import { expect, it } from 'vitest';
import { checkedProbeReport, checkedProbeUsage, groupedProbeFiles } from '../../tools/printed-probe-report';

const selected = [{ testFile: '/test/probe.test.ts', tests: ['accept', 'decline'] }];
const report = {
  success: true,
  numTotalTests: 2,
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: selected[0]!.testFile,
      status: 'passed',
      assertionResults: [
        { fullName: 'accept', status: 'passed', failureMessages: [] },
        { fullName: 'decline', status: 'passed', failureMessages: [] },
      ],
    },
  ],
};
const usage = ['accept', 'decline'].map((testName) => ({
  testName,
  testFile: selected[0]!.testFile,
  runtime: { hash: 'fixture' },
  formatId: 'akh-hou',
  controllers: ['local'],
}));
const partitioned = [
  { testFile: selected[0]!.testFile, tests: ['accept'], controller: 'local' as const },
  { testFile: selected[0]!.testFile, tests: ['decline'], controller: 'engine' as const },
];
const mixedUsage = usage.map((row) => ({
  ...row,
  controllers: row.testName === 'accept' ? ['local'] : ['engine'],
}));
it.each([
  { input: [] },
  { input: [{ testFile: '/test/probe.test.ts', tests: [] }] },
  { input: [{ testFile: '/test/probe.test.ts', tests: ['accept', 'accept'] }] },
])('refuses empty or internally overlapping selections %#', ({ input }) => {
  expect(() => groupedProbeFiles(input)).toThrow();
});
it('groups disjoint claims without changing their input or conflating files', () => {
  const input = [...partitioned, { testFile: '/test/other.test.ts', tests: ['accept'] }];
  const before = structuredClone(input);
  expect(groupedProbeFiles(input)).toEqual([
    selected[0],
    { testFile: '/test/other.test.ts', tests: ['accept'] },
  ]);
  expect(input).toEqual(before);
});
it('still rejects omitted or extra assertions across disjoint partitions', () => {
  expect(() => checkedProbeReport(report, partitioned.slice(0, 1))).toThrow();
  expect(() =>
    checkedProbeReport(report, [...partitioned, { testFile: selected[0]!.testFile, tests: ['unexpected'] }]),
  ).toThrow();
});
it('checks disjoint controller claims against one complete test-file result', () => {
  expect(() => checkedProbeReport(report, partitioned)).not.toThrow();
  expect(() => checkedProbeUsage(mixedUsage, partitioned, { hash: 'fixture' }, 'akh-hou')).not.toThrow();
});
it('does not borrow another assertion’s controller in the same file', () => {
  expect(() => checkedProbeUsage(usage, partitioned, { hash: 'fixture' }, 'akh-hou')).toThrow(
    /snapshot usage/,
  );
});
it('refuses overlapping assertion claims even when the aggregate happens to pass', () => {
  const overlapping = [...partitioned, { ...partitioned[0]!, controller: 'engine' as const }];
  expect(() => checkedProbeReport(report, overlapping)).toThrow();
  expect(() => checkedProbeUsage(mixedUsage, overlapping, { hash: 'fixture' }, 'akh-hou')).toThrow();
});
it('requires matching snapshot session usage for every reported assertion', () => {
  expect(() => checkedProbeUsage(usage, selected, { hash: 'fixture' }, 'akh-hou')).not.toThrow();
});
it('does not relabel a setup scenario as ordinary whole-game probe usage', () => {
  const scenarios = usage.map((row) => ({ ...row, scenario: { sha256: 'a'.repeat(64) } }));
  expect(() => checkedProbeUsage(scenarios, selected, { hash: 'fixture' }, 'akh-hou')).toThrow(
    /snapshot usage/,
  );
});
it('requires the claimed controller to have participated in the measured session', () => {
  expect(() =>
    checkedProbeUsage(
      usage,
      selected.map((file) => ({ ...file, controller: 'engine' })),
      { hash: 'fixture' },
      'akh-hou',
    ),
  ).toThrow(/snapshot usage/);
});
it.each(
  [
    [],
    usage.slice(0, 1),
    [...usage, { ...usage[0], testName: 'unexpected' }],
    usage.map((row) => ({ ...row, runtime: { hash: 'another-runtime' } })),
    usage.map((row) => ({ ...row, formatId: 'another-format' })),
  ].map((input) => ({ input })),
)('refuses missing, foreign or relabeled snapshot session usage %#', ({ input }) => {
  expect(() => checkedProbeUsage(input, selected, { hash: 'fixture' }, 'akh-hou')).toThrow(/snapshot usage/);
});
it('requires every expected test to pass in the exact selected file', () => {
  expect(() => checkedProbeReport(report, selected)).not.toThrow();
});
it.each([
  { ...report, success: false },
  { ...report, numTotalTests: 0 },
  { ...report, numPassedTests: 1 },
  { ...report, numPendingTests: 1 },
  { ...report, numFailedTests: 1 },
  { ...report, numTodoTests: 1 },
  { ...report, testResults: [] },
  { ...report, testResults: [{ ...report.testResults[0], name: '/another/probe.test.ts' }] },
  { ...report, testResults: [{ ...report.testResults[0], status: 'failed' }] },
  {
    ...report,
    testResults: [
      {
        ...report.testResults[0],
        assertionResults: [{ fullName: 'accept', status: 'skipped', failureMessages: [] }],
      },
    ],
  },
  {
    ...report,
    testResults: [
      {
        ...report.testResults[0],
        assertionResults: [
          report.testResults[0]!.assertionResults[0],
          report.testResults[0]!.assertionResults[0],
        ],
      },
    ],
  },
  {
    ...report,
    testResults: [
      {
        ...report.testResults[0],
        assertionResults: report.testResults[0]!.assertionResults.map((result) => ({
          ...result,
          failureMessages: ['unhandled failure'],
        })),
      },
    ],
  },
])('refuses incomplete, failed, duplicated or relabeled test results %#', (input) => {
  expect(() => checkedProbeReport(input, selected)).toThrow();
});
