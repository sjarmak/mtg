/**
 * Whether a typecheck run is a fact about the tree (mtg-urbjc).
 *
 * The gate stored a red base verdict from a `tsc` that printed no diagnostic and
 * whose tree passed `tsc` two minutes later. Two halves are checked here: what
 * `judgeTypecheck` concludes from a run's status, signal and output, and that
 * `runTypecheck` reads those three things off a real process faithfully, using
 * `sh` stubs that end the three ways the bead names.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runTypecheck } from '../tools/gate/typecheck';
import { decideRecording, judgeTypecheck } from '../tools/gate/verdict';

const DIAGNOSTIC =
  "packages/ui/src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";

async function stub(script: string) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const forwarded: string[] = [];
  stdout.on('data', (chunk: Buffer) => forwarded.push(`out:${chunk.toString('utf8')}`));
  stderr.on('data', (chunk: Buffer) => forwarded.push(`err:${chunk.toString('utf8')}`));
  const run = await runTypecheck(['sh', '-c', script], process.env, { stdout, stderr });
  return { run, forwarded };
}

describe('judgeTypecheck', () => {
  it('passes a clean exit', () => {
    expect(judgeTypecheck({ status: 0, signal: null, output: '> tsc --noEmit\n' })).toEqual({
      kind: 'passed',
    });
  });

  it('refuses on a status and a TypeScript error, keeping the first error line', () => {
    const output = `> tsc --noEmit\n${DIAGNOSTIC}\npackages/ui/src/b.ts(1,1): error TS2304: Cannot find name 'x'.\n`;
    expect(judgeTypecheck({ status: 2, signal: null, output })).toEqual({
      kind: 'refused',
      firstDiagnostic: DIAGNOSTIC,
    });
  });

  it('accepts an error that names no file, which tsc prints for a bad config', () => {
    const output = "error TS5023: Unknown compiler option 'nope'.\n";
    expect(judgeTypecheck({ status: 1, signal: null, output }).kind).toBe('refused');
  });

  it('does not take the word error for a diagnostic', () => {
    const output = 'npm error Lifecycle script failed\nsh: 1: tsc: not found\n';
    expect(judgeTypecheck({ status: 127, signal: null, output }).kind).toBe('unreliable');
  });

  it('distrusts a non-zero exit that printed nothing', () => {
    const judgment = judgeTypecheck({ status: 2, signal: null, output: '> tsc --noEmit\n' });
    expect(judgment.kind).toBe('unreliable');
    expect(judgment.kind === 'unreliable' && judgment.why).toContain('printed no TypeScript error');
  });

  it('distrusts a signal even when diagnostics were already printed', () => {
    const judgment = judgeTypecheck({ status: null, signal: 'SIGKILL', output: `${DIAGNOSTIC}\n` });
    expect(judgment.kind).toBe('unreliable');
    expect(judgment.kind === 'unreliable' && judgment.why).toContain('SIGKILL');
  });

  it('distrusts a run that never produced a status', () => {
    expect(judgeTypecheck({ status: null, signal: null, output: '' }).kind).toBe('unreliable');
  });

  it('caps a diagnostic that runs to paragraphs', () => {
    const output = `a.ts(1,1): error TS2322: ${'x'.repeat(2_000)}\n`;
    const judgment = judgeTypecheck({ status: 2, signal: null, output });
    expect(judgment.kind === 'refused' && judgment.firstDiagnostic.length).toBe(300);
  });
});

describe('runTypecheck against a real process', () => {
  it('reports a process killed by a signal as no status and that signal, and the gate records nothing', async () => {
    const { run } = await stub('kill -TERM $$');
    expect(run.status).toBeNull();
    expect(run.signal).toBe('SIGTERM');
    const judgment = judgeTypecheck(run);
    expect(
      decideRecording({ exitCode: 1, typecheck: judgment, redFiles: [], timeoutOnlyFiles: [] }).kind,
    ).toBe('discard');
  });

  it('reports exit 2 with no output as a status and empty output, and the gate records nothing', async () => {
    const { run } = await stub('exit 2');
    expect(run).toEqual({ status: 2, signal: null, output: '' });
    const judgment = judgeTypecheck(run);
    expect(
      decideRecording({ exitCode: 2, typecheck: judgment, redFiles: [], timeoutOnlyFiles: [] }).kind,
    ).toBe('discard');
  });

  it('reports error TS2322 and exit 2 as a refusal, and the gate records it with the diagnostic', async () => {
    const { run } = await stub(`printf '%s\\n' "${DIAGNOSTIC}"; exit 2`);
    expect(run.status).toBe(2);
    const judgment = judgeTypecheck(run);
    expect(judgment.kind).toBe('refused');
    const recording = decideRecording({
      exitCode: 2,
      typecheck: judgment,
      redFiles: [],
      timeoutOnlyFiles: [],
    });
    expect(recording.kind).toBe('record');
    expect(recording.why).toContain('error TS2322');
  });

  it('forwards each stream to its own sink while keeping what it printed', async () => {
    const { run, forwarded } = await stub('echo to-out; echo to-err >&2');
    expect(forwarded).toContain('out:to-out\n');
    expect(forwarded).toContain('err:to-err\n');
    expect(run.output).toContain('to-out');
    expect(run.output).toContain('to-err');
  });

  it('reports a command that cannot start as no status, and says so on stderr', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const said: string[] = [];
    stderr.on('data', (chunk: Buffer) => said.push(chunk.toString('utf8')));
    const run = await runTypecheck(['/nonexistent/gate-typecheck-stub'], process.env, { stdout, stderr });
    expect(run.status).toBeNull();
    expect(run.signal).toBeNull();
    expect(said.join('')).toContain('gate: could not run /nonexistent/gate-typecheck-stub');
    expect(judgeTypecheck(run).kind).toBe('unreliable');
  });
});
