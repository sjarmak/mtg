import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCodexQualityReviewer,
  readCodexReviewEvents,
} from '../src/legacy-cube-calibration/codex-review';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/legacy-cube-calibration/codex-process', () => ({ runCodexProcess: execute }));
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const events = [
  { type: 'thread.started', thread_id: 'fixture-thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '{"answer":true}' } },
  { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
];
const transcript = (rows = events) => rows.map((r) => JSON.stringify(r)).join('\n');
it('accepts only a complete single-turn, tool-free JSON judgment', () => {
  expect(readCodexReviewEvents(transcript())).toEqual({
    runId: 'fixture-thread',
    response: { answer: true },
  });
  expect(() => readCodexReviewEvents(transcript(events.slice(0, -1)))).toThrow();
  expect(() => readCodexReviewEvents(`${transcript()}\nnot JSON`)).toThrow();
  expect(() => readCodexReviewEvents(`${transcript()}\n${JSON.stringify(events[1])}`)).toThrow();
});
it.each(['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'future_tool'])(
  'rejects %s instead of importing extra-context evidence',
  (type) => {
    const rows = [
      ...events.slice(0, 2),
      { type: 'item.completed', item: { id: 'tool', type, text: 'extra context' } },
      ...events.slice(2),
    ];
    expect(() => readCodexReviewEvents(transcript(rows))).toThrow(/tool|unsupported/i);
  },
);
async function setup() {
  const archive = await mkdtemp(join(tmpdir(), 'mtg-codex-archive-'));
  roots.push(archive);
  const reviewer = createCodexQualityReviewer({
    binary: '/verified/codex',
    model: 'fixture-model',
    archive,
    runtimeSha256: 'a'.repeat(64),
  });
  execute.mockImplementation(async ({ args }: { args: string[] }) => ({
    stdout: args.includes('--version') ? 'codex-cli 0.154.0\n' : args.includes('status') ? '' : transcript(),
    stderr: args.includes('status') ? 'Logged in using ChatGPT\n' : '',
    exitCode: 0,
    signal: null,
    error: null,
  }));
  return {
    archive,
    reviewer,
    task: { prompt: 'Only the canonical task.', schema: { type: 'object' }, taskSha256: 'b'.repeat(64) },
  };
}
it('uses OAuth-only isolated execution and archives actual output without forwarding API keys', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'must-not-forward');
  vi.stubEnv('CODEX_API_KEY', 'must-not-forward');
  const { archive, reviewer, task } = await setup();
  const result = await reviewer.review(task);
  expect(result.provenance).toMatchObject({
    authentication: 'chatgpt-oauth',
    requestedModel: 'fixture-model',
    resolvedModel: null,
    runId: 'fixture-thread',
  });
  const call = execute.mock.calls.find(([args]) => args.args.includes('exec'))![0];
  expect(call.env.OPENAI_API_KEY).toBeUndefined();
  expect(call.env.CODEX_API_KEY).toBeUndefined();
  expect(call.args).toEqual(
    expect.arrayContaining([
      '--ignore-user-config',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--output-schema',
      'forced_login_method="chatgpt"',
      'project_doc_max_bytes=0',
      'suppress_unstable_features_warning=true',
    ]),
  );
  expect(call.input).toContain(task.prompt);
  expect(await readFile(join(archive, task.taskSha256, 'review.stdout.txt'), 'utf8')).toBe(transcript());
  await expect(readdir(call.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(reviewer.review(task)).rejects.toMatchObject({ code: 'EEXIST' });
});
it('refuses API-key authentication before the model call', async () => {
  const { reviewer, task } = await setup();
  execute.mockResolvedValue({
    stdout: 'Logged in using an API key',
    stderr: '',
    exitCode: 0,
    signal: null,
    error: null,
  });
  await expect(reviewer.review(task)).rejects.toThrow(/ChatGPT|OAuth/);
  expect(execute.mock.calls.some(([call]) => call.args.includes('exec'))).toBe(false);
});
it('archives failed executions but does not issue a receipt', async () => {
  const { archive, reviewer, task } = await setup();
  const valid = execute.getMockImplementation()!;
  execute.mockImplementation(async (call) =>
    call.args.includes('exec')
      ? { stdout: transcript(), stderr: 'interrupted', exitCode: 0, signal: null, error: 'timeout' }
      : valid(call),
  );
  await expect(reviewer.review(task)).rejects.toThrow(/timeout/);
  expect(await readFile(join(archive, task.taskSha256, 'review.stderr.txt'), 'utf8')).toBe('interrupted');
});
