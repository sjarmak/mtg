import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { checkedScenarioUsage } from '../../tools/printed-scenario-report';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seat = { life: 20, hand: [], library: ['Plains'], battlefield: ['Gust Walker'], graveyard: [] };
const state = { schemaVersion: 1, active: 1, phase: 'MAIN1', seats: [seat, seat] };
const identity = {
  id: 'case-1',
  ancestorTitles: ['exert > contract', 'native'],
  title: "'Gust Walker': accepts",
};
const fullName = [...identity.ancestorTitles, identity.title].join(' ');
const runtime = { hash: 'fixture' };
const selected = [
  {
    testFile: '/test/probe.test.ts',
    tests: [fullName],
    controller: 'engine' as const,
    sourceName: 'Gust Walker',
    sourceSeat: 1 as const,
  },
];
const usage = [
  {
    testFile: '/test/probe.test.ts',
    testName: 'diagnostic only',
    testIdentity: identity,
    runtime,
    formatId: 'akh-hou',
    controllers: ['local', 'engine'],
    scenario: { state, sha256: hash(state), seed: 'fixture', maximumTurns: 8 },
  },
];
const report = {
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: '/test/probe.test.ts',
      status: 'passed',
      assertionResults: [{ ...identity, fullName, status: 'passed', failureMessages: [] }],
    },
  ],
};

it('joins observed nested/parameterized identities structurally, not by diagnostic text', () => {
  expect(checkedScenarioUsage(usage, report, selected, runtime)).toEqual(usage);
});
it('can bind a callback controlled by the seat opposite the source card', () => {
  expect(
    checkedScenarioUsage(usage, report, [{ ...selected[0]!, controller: 'local', decisionSeat: 0 }], runtime),
  ).toEqual(usage);
});
it.each(
  [
    [],
    [...usage, usage[0]],
    usage.map((row) => ({ ...row, runtime: { hash: 'foreign' } })),
    usage.map((row) => ({ ...row, controllers: ['engine', 'local'] })),
    usage.map((row) => ({
      ...row,
      testIdentity: { ...identity, ancestorTitles: ['exert', 'contract > native'] },
    })),
    usage.map((row) => ({ ...row, scenario: { ...row.scenario, sha256: 'a'.repeat(64) } })),
    usage.map((row) => ({ ...row, testFile: '/foreign.test.ts' })),
    usage.map(({ scenario: _scenario, ...row }) => row),
    usage.map(({ testIdentity: _identity, ...row }) => row),
  ].map((input) => ({ input })),
)('rejects missing, extra, mismatched or scope-laundered evidence %#', ({ input }) => {
  expect(() => checkedScenarioUsage(input, report, selected, runtime)).toThrow();
});
it('requires the claimed source in the claimed seat, not merely a participating controller', () => {
  expect(() =>
    checkedScenarioUsage(usage, report, [{ ...selected[0]!, sourceName: 'Glorybringer' }], runtime),
  ).toThrow(/source/);
});
it('refuses failed report assertions even when usage is present', () => {
  expect(() => checkedScenarioUsage(usage, { ...report, numFailedTests: 1 }, selected, runtime)).toThrow();
});
it('refuses a selected label attached to a different structured report identity', () => {
  const assertion = report.testResults[0]!.assertionResults[0]!;
  const falseLabel = {
    ...report,
    testResults: [
      { ...report.testResults[0], assertionResults: [{ ...assertion, title: 'another assertion' }] },
    ],
  };
  const falseUsage = usage.map((row) => ({
    ...row,
    testIdentity: { ...identity, title: 'another assertion' },
  }));
  expect(() => checkedScenarioUsage(falseUsage, falseLabel, selected, runtime)).toThrow(/label/);
});
it('refuses flattened report collisions and absent structured report identities', () => {
  const assertion = report.testResults[0]!.assertionResults[0]!;
  const missing = {
    ...report,
    testResults: [
      { ...report.testResults[0], assertionResults: [{ fullName, status: 'passed', failureMessages: [] }] },
    ],
  };
  expect(() => checkedScenarioUsage(usage, missing, selected, runtime)).toThrow();
  const collision = {
    ...report,
    numTotalTests: 2,
    numPassedTests: 2,
    testResults: [
      {
        ...report.testResults[0],
        assertionResults: [assertion, { ...assertion, ancestorTitles: ['exert > contract native'] }],
      },
    ],
  };
  expect(() => checkedScenarioUsage(usage, collision, selected, runtime)).toThrow();
});
