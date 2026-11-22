/** A bounded request/response channel over one separately spawned process. */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { SessionError } from '@mtg/engine';
import { killProcessGroup, trackProcessGroup } from '../process-group';
import { bridgeResponse, FORGE_BRIDGE_LINE_PREFIX } from './protocol';
import type { BridgeRequest, BridgeResponse } from './protocol';

export interface BridgeLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

interface Pending {
  readonly resolve: (response: BridgeResponse) => void;
  readonly reject: (error: SessionError) => void;
  readonly timer: NodeJS.Timeout;
}

const STDERR_LIMIT = 16 * 1024;

export class ForgeBridgeProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, Pending>();
  #stderr = '';
  #failed: SessionError | null = null;
  #closed = false;
  #requestSequence = 0;

  constructor(launch: BridgeLaunch) {
    this.#timeoutMs = launch.timeoutMs;
    this.#child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: launch.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    trackProcessGroup(this.#child.pid);
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk: string) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    this.#child.stdin.on('error', (cause: Error) => this.#stdinFailed(cause));
    this.#child.once('error', (cause: Error) => {
      this.#fail({ kind: 'backend-failure', message: `Forge bridge failed to spawn: ${cause.message}` });
    });
    this.#child.once('close', (code, signal) => {
      // The leader is gone; reap any straggler in its group and stop tracking it.
      killProcessGroup(this.#child.pid);
      if (this.#closed) return;
      const suffix = this.#stderr.trim().length === 0 ? '' : `; stderr: ${this.#stderr.trim()}`;
      this.#fail({
        kind: 'backend-failure',
        message: `Forge bridge exited with code ${String(code)} and signal ${String(signal)}${suffix}`,
      });
    });

    const lines = createInterface({ input: this.#child.stdout });
    lines.on('line', (line) => this.#receive(line));
  }

  nextRequestId(): string {
    const id = `request-${String(this.#requestSequence)}`;
    this.#requestSequence += 1;
    return id;
  }

  request(request: BridgeRequest): Promise<BridgeResponse> {
    if (this.#failed !== null) return Promise.reject(this.#failed);
    if (this.#closed) {
      return Promise.reject({
        kind: 'backend-failure',
        message: 'Forge bridge is closed',
      } satisfies SessionError);
    }
    return new Promise<BridgeResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId);
        const error: SessionError = {
          kind: 'timeout',
          message: `Forge bridge did not answer within ${String(this.#timeoutMs)} ms`,
          millis: this.#timeoutMs,
        };
        rejectPromise(error);
        this.#fail(error);
      }, this.#timeoutMs);
      this.#pending.set(request.requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      try {
        this.#child.stdin.write(`${JSON.stringify(request)}\n`, (cause) => {
          if (cause !== null && cause !== undefined) this.#stdinFailed(cause);
        });
      } catch (cause) {
        this.#stdinFailed(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  terminate(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject({ kind: 'backend-failure', message: 'Forge bridge was closed' });
    }
    this.#pending.clear();
    this.#child.stdin.end();
    this.#killChild();
  }

  #receive(line: string): void {
    // xvfb-run merges the JVM's stderr into stdout. Forge is deliberately
    // verbose, so only the bridge's framed JSONL belongs to this channel.
    if (!line.startsWith(FORGE_BRIDGE_LINE_PREFIX)) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line.slice(FORGE_BRIDGE_LINE_PREFIX.length));
    } catch {
      this.#fail({ kind: 'backend-failure', message: 'Forge bridge wrote malformed JSON' });
      return;
    }
    const parsed = bridgeResponse.safeParse(decoded);
    if (!parsed.success) {
      this.#fail({
        kind: 'backend-failure',
        message: `Forge bridge wrote an invalid response: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`,
      });
      return;
    }
    const pending = this.#pending.get(parsed.data.requestId);
    if (pending === undefined) {
      this.#fail({
        kind: 'backend-failure',
        message: `Forge bridge answered unknown request "${parsed.data.requestId}"`,
      });
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(parsed.data.requestId);
    pending.resolve(parsed.data);
  }

  #fail(error: SessionError): void {
    if (this.#failed !== null || this.#closed) return;
    this.#failed = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#killChild();
  }

  #stdinFailed(cause: Error): void {
    this.#fail({ kind: 'backend-failure', message: `Forge bridge stdin failed: ${cause.message}` });
  }

  /**
   * xvfb-run is a shell script that traps EXIT to kill the Xvfb it started;
   * SIGKILL to the shell itself bypasses that trap and orphans Xvfb. Killing
   * the whole process group (this child is spawned detached, so its pid is
   * also its group id) reaps xvfb-run, Xvfb and the JVM together.
   */
  #killChild(): void {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    const pid = this.#child.pid;
    if (pid === undefined) return;
    try {
      killProcessGroup(pid);
    } catch {
      this.#child.kill('SIGKILL');
    }
  }
}
