/**
 * The real-Chrome harness, shared by every `.browser.test.ts` under this package.
 *
 * jsdom performs no layout: `getBoundingClientRect` is all zeros and
 * `scrollWidth` is `clientWidth` on everything, so no assertion about a box, a
 * clip, an ellipsis or a wrap can be made there. These tests render the shipped
 * markup with the shipped sheet to a static file and ask chrome-headless-shell
 * for the numbers over CDP.
 *
 * It lived inside `../play/battlefield-geometry.browser.test.ts` until a second
 * browser test needed it. Nothing about the harness is about a battlefield —
 * every named deadline, the SIGTERM-then-SIGKILL escalation and the settle
 * predicate are the same on any page — and a copy of 350 lines per test file is
 * a second place for a deadline to drift.
 *
 * Deadlines are named rather than open: a hung CDP call, a socket that closes
 * mid-flight and a child that ignores SIGTERM each fail with a sentence saying
 * which bound was crossed. `../play/battlefield-geometry.browser.test.ts` keeps
 * the unit tests that prove those three paths, driven through `hostileClient`
 * and `NonExitingChild`, and they need no browser.
 *
 * It imports nothing from `vitest`, and that is load-bearing rather than
 * incidental: `vitest` throws on import outside a `vitest` command, so a plain
 * Node program that wanted a browser could not have one while the harness and
 * the `browserIt` wrapper shared a file. `./chrome.ts` is that wrapper now, and
 * it re-exports everything here, so no test moved.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CHROME = join(
  homedir(),
  '.cache',
  'ms-playwright',
  'chromium_headless_shell-1234',
  'chrome-headless-shell-linux64',
  'chrome-headless-shell',
);

/** Where the browser is, and the one environment variable that moves it. */
export const chromePath = process.env['MTG_CHROME_HEADLESS_SHELL'] ?? DEFAULT_CHROME;

/** Whether this machine can run any of it. */
export const browserPresent = existsSync(chromePath);

/**
 * What a run that requires the browser is told when there isn't one.
 *
 * A skip is the right default and the wrong answer for a gate: the whole
 * `browser` project reports ten green checks on a machine with no binary, and
 * green is exactly what a CI image with a broken cache would then report about
 * a layout nobody measured. `MTG_REQUIRE_BROWSER=1` is the run that says a skip
 * is a failure — CI sets it, a laptop does not — and the failure names the path
 * it looked at, the variable that moves the path, and the command that installs
 * the binary, because the reader of that red is someone whose checkout is fine.
 *
 * It installs nothing itself. `npx playwright install chromium-headless-shell`
 * downloads about 90 MB from a third party, which is not a thing a test run
 * decides to do.
 */
export function missingBrowserMessage(): string {
  return [
    `No browser at ${chromePath}, and MTG_REQUIRE_BROWSER=1 says this run needs one.`,
    'Install it with `npx playwright install chromium-headless-shell`,',
    'or point MTG_CHROME_HEADLESS_SHELL at an existing chrome-headless-shell binary.',
  ].join(' ');
}

/**
 * The three things a browser rig can be, and which one this run is.
 *
 * A pure function of the two facts rather than a ternary inside the export, so
 * `../browser-project.test.ts` can hold all four combinations to it without
 * reloading a module or inventing a filesystem. `it.skip` is a getter that
 * builds a fresh chain on every access, so the mode is the only thing about
 * this decision that can be compared.
 */
export type BrowserMode = 'run' | 'skip' | 'require';

export function browserMode(present: boolean, required: string | undefined): BrowserMode {
  if (present) return 'run';
  return required === '1' ? 'require' : 'skip';
}

interface PendingCall {
  readonly method: string;
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface CdpSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;
const CDP_CONNECT_TIMEOUT_MS = 3_000;
const CDP_CALL_TIMEOUT_MS = 4_000;
const CDP_CLEANUP_TIMEOUT_MS = 2_000;
const SOCKET_CLOSE_TIMEOUT_MS = 1_000;
const CHILD_EXIT_TIMEOUT_MS = 2_000;

export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One CDP event: what fired, what it carried, and which session it came from. */
export interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
  /** Absent for a browser-wide event, present for one scoped to an attached target. */
  readonly sessionId: string | undefined;
}

interface EventWaiter {
  readonly resolve: (event: CdpEvent) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const CDP_EVENT_TIMEOUT_MS = 4_000;

/**
 * Everything one subscription has seen, and a way to wait for the next thing.
 *
 * A recording rather than a callback because the interesting assertion about a
 * download is a **silence**: a page that clicks an `a[download]` is told nothing
 * whether the file landed or the request was dropped, so the only way to tell
 * those apart is to hold the browser's own account of the window and read it
 * after the fact. `next` is for the other half, where a test has to wait for
 * something before it can go on.
 *
 * Buffering starts when the recording is made, not when it is read. Events that
 * fired before that are gone, which is why a test starts recording and then acts.
 */
export class CdpRecording {
  private readonly seen: CdpEvent[] = [];
  private readonly waiters: EventWaiter[] = [];
  private stopped = false;

  constructor(
    private readonly methods: ReadonlySet<string>,
    private readonly release: () => void,
  ) {}

  /** True when this recording wants the event, which an empty method set always does. */
  wants(method: string): boolean {
    return this.methods.size === 0 || this.methods.has(method);
  }

  /** Called by the client. Not part of what a test uses. */
  deliver(event: CdpEvent): void {
    if (this.stopped) return;
    this.seen.push(event);
    const waiter = this.waiters.shift();
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  }

  /** Every matching event since the recording started, in arrival order. */
  get events(): readonly CdpEvent[] {
    return this.seen;
  }

  /** Matching events of one method, for a recording that watches several. */
  of(method: string): readonly CdpEvent[] {
    return this.seen.filter((event) => event.method === method);
  }

  /**
   * The next matching event, or a rejection naming what was waited for.
   *
   * An event already buffered and not yet taken by an earlier `next` does not
   * satisfy this call: `next` is a forward-looking wait, and `events` is how a
   * test reads what already happened. Mixing the two would make a test's meaning
   * depend on how fast Chrome answered.
   */
  next(timeoutMs = CDP_EVENT_TIMEOUT_MS): Promise<CdpEvent> {
    if (this.stopped) return Promise.reject(new Error('CDP recording is stopped'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new Error(`no CDP ${[...this.methods].join(' or ') || 'event'} within ${String(timeoutMs)}ms`),
        );
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  /** Stops buffering and fails anything still waiting. Safe to call twice. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('CDP recording stopped while waiting'));
    }
  }
}

export class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<number, PendingCall>();
  private readonly recordings = new Set<CdpRecording>();
  private closedReason: string | null = null;

  private constructor(private readonly socket: CdpSocket) {
    socket.onmessage = (event): void => {
      if (typeof event.data !== 'string') return;
      let message: {
        readonly id?: number;
        readonly method?: string;
        readonly params?: Record<string, unknown>;
        readonly sessionId?: string;
        readonly result?: Record<string, unknown>;
        readonly error?: unknown;
      };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch (error) {
        this.rejectPending(`CDP socket sent invalid JSON: ${reason(error)}`);
        return;
      }
      if (message.id === undefined) {
        // An event, which this client dropped outright until `mtg-l191`: a
        // download reports nothing to the page, so the browser's own account of
        // it is the only account there is.
        if (typeof message.method === 'string') {
          const delivered: CdpEvent = {
            method: message.method,
            params: message.params ?? {},
            sessionId: message.sessionId,
          };
          for (const recording of this.recordings) {
            if (recording.wants(delivered.method)) recording.deliver(delivered);
          }
        }
        return;
      }
      const call = this.pending.get(message.id);
      if (call === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error === undefined) call.resolve(message.result ?? {});
      else call.reject(new Error(`CDP ${call.method} failed: ${JSON.stringify(message.error)}`));
    };
    socket.onerror = (): void => {
      this.closedReason = 'CDP socket errored';
      this.rejectPending(this.closedReason);
    };
    socket.onclose = (event): void => {
      const detail = `${String(event.code)}${event.reason === '' ? '' : ` ${event.reason}`}`;
      this.closedReason = `CDP socket closed (${detail})`;
      this.rejectPending(this.closedReason);
    };
  }

  private rejectPending(prefix: string): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(`${prefix} during ${call.method}`));
    }
    this.pending.clear();
  }

  /**
   * Starts buffering the named events, or every event when none are named.
   *
   * The caller stops it. A recording left running costs one set membership and
   * an array that grows with the socket, which is why the browser tests stop
   * theirs in a `finally` beside the target cleanup.
   */
  record(...methods: readonly string[]): CdpRecording {
    const recording: CdpRecording = new CdpRecording(new Set(methods), () => {
      this.recordings.delete(recording);
    });
    this.recordings.add(recording);
    return recording;
  }

  static async connect(url: string, timeoutMs = CDP_CONNECT_TIMEOUT_MS): Promise<CdpClient> {
    const socket = new WebSocket(url) as unknown as CdpSocket;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (result: 'open' | 'error' | 'close' | 'timeout'): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        if (result === 'open') resolve();
        else if (result === 'timeout') {
          reject(new Error(`Chrome CDP socket did not open at ${url} within ${String(timeoutMs)}ms`));
        } else {
          reject(new Error(`Chrome CDP socket ${result}ed before opening at ${url}`));
        }
      };
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      socket.onopen = (): void => finish('open');
      socket.onerror = (): void => finish('error');
      socket.onclose = (): void => finish('close');
    });
    return new CdpClient(socket);
  }

  call(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
    timeoutMs = CDP_CALL_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.closedReason !== null || this.socket.readyState !== SOCKET_OPEN) {
      return Promise.reject(new Error(`${this.closedReason ?? 'CDP socket is not open'} during ${method}`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} did not answer within ${String(timeoutMs)}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`CDP ${method} could not be sent: ${reason(error)}`));
      }
    });
  }

  async close(timeoutMs = SOCKET_CLOSE_TIMEOUT_MS): Promise<void> {
    if (this.socket.readyState === SOCKET_CLOSED) return;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const previousClose = this.socket.onclose;
      const previousError = this.socket.onerror;
      const finish = (error?: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.socket.onclose = previousClose;
        this.socket.onerror = previousError;
        if (error === undefined) resolve();
        else reject(error);
      };
      const timer = setTimeout(
        () => finish(new Error(`CDP socket did not close within ${String(timeoutMs)}ms`)),
        timeoutMs,
      );
      this.socket.onclose = (event): void => {
        previousClose?.(event);
        finish();
      };
      this.socket.onerror = (): void => {
        previousError?.();
        finish(new Error('CDP socket errored while closing'));
      };
      try {
        this.socket.close();
      } catch (error) {
        finish(new Error(`CDP socket close threw: ${reason(error)}`));
      }
    });
  }
}

interface TerminationWindows {
  readonly termMs: number;
  readonly killMs: number;
}

/** Anything `installOrphanGuard` can kill: a real child, or a test double. */
export interface KillableChild {
  kill(signal: NodeJS.Signals): boolean;
}

/** The slice of `process` the guard needs, so a test never sends itself a real signal. */
export interface SignalHost {
  readonly pid?: number;
  once(event: NodeJS.Signals, listener: () => void): this;
  removeListener(event: NodeJS.Signals, listener: () => void): this;
  kill(pid: number, signal: NodeJS.Signals): boolean;
}

/**
 * Every Chrome child `launchChrome` has spawned and not yet reaped.
 *
 * mtg-4by7l: `chrome-headless-shell` processes accumulate as orphans on this
 * host, some 431 hours old, reparented to PID 1 -- the tell that the parent
 * exited without closing them. Every `.browser.test.ts` already shuts Chrome
 * down inline (`shutdownChrome`/`terminateChild`), but that is ordinary
 * control flow: it runs only if the test function is still running. A test
 * process killed by a signal (this lane kills runs on load-driven aborts and
 * session restarts) stops executing JS wherever it happened to be, so a
 * browser launched moments earlier is simply abandoned. `launchChrome` is not
 * `detached`, so the child shares this process's process group, but the OS
 * only delivers a group-wide signal when the *sender* targets the group; a
 * sender that targets this PID alone leaves the child alive the instant this
 * process exits.
 */
const liveChildren = new Set<KillableChild>();

/**
 * Lets a Chrome-like child launched outside `launchChrome` join the same
 * orphan sweep, since `installOrphanGuard()` below wires itself to `process`
 * once and a second call with a different set is a no-op (`guardedHosts` keys
 * on the target, not the set). `stagehand-chromium.ts` spawns full Chromium
 * for the armed Stagehand path (`mtg-jiusn`) and needs exactly this, nothing
 * about `launchChrome` itself.
 */
export function trackLiveChild(
  child: KillableChild & { once(event: 'exit', listener: () => void): unknown },
): void {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
}

/** Hosts `installOrphanGuard` has already wired, so a repeat call is a no-op. */
const guardedHosts = new WeakSet<object>();

/**
 * Best-effort SIGKILL of every child still tracked, one at a time, never
 * letting one throw stop the rest.
 */
export function killLiveChildren(children: Iterable<KillableChild>): void {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best effort: whatever is delivering this signal is exiting regardless.
    }
  }
}

/**
 * Closes the gap `liveChildren`'s docstring above describes: on SIGTERM or
 * SIGINT, kill every tracked child before this process goes down with it.
 *
 * A `SIGKILL` sent to this PID alone cannot be caught, so a child of a process
 * killed that way is still orphaned; this covers the catchable signals only.
 * It wires a given host once. On a signal it removes only the listener it
 * added, then re-raises the signal against itself, so any other handler
 * already registered for it still runs and the process still terminates the
 * way its caller expected.
 */
export function installOrphanGuard(
  children: ReadonlySet<KillableChild> = liveChildren,
  target: SignalHost = process,
  signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
): void {
  if (guardedHosts.has(target)) return;
  guardedHosts.add(target);
  for (const signal of signals) {
    const onSignal = (): void => {
      killLiveChildren(children);
      target.removeListener(signal, onSignal);
      target.kill(target.pid ?? process.pid, signal);
    };
    target.once(signal, onSignal);
  }
}

export function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  context: string,
): Promise<void> {
  if (child.exitCode !== null || (child.signalCode ?? null) !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const exited = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', exited);
      reject(new Error(`Chrome did not exit ${context} within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.once('exit', exited);
  });
}

export async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  windows: TerminationWindows = {
    termMs: CHILD_EXIT_TIMEOUT_MS,
    killMs: CHILD_EXIT_TIMEOUT_MS,
  },
): Promise<void> {
  if (child.exitCode !== null || (child.signalCode ?? null) !== null) return;
  child.kill('SIGTERM');
  try {
    await waitForChildExit(child, windows.termMs, 'after SIGTERM');
    return;
  } catch {
    if (child.exitCode !== null || (child.signalCode ?? null) !== null) return;
  }
  child.kill('SIGKILL');
  await waitForChildExit(child, windows.killMs, 'after SIGKILL');
}

export async function shutdownChrome(chrome: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly client: CdpClient;
}): Promise<void> {
  let browserCloseError: Error | null = null;
  try {
    await chrome.client.call('Browser.close', {}, undefined, CDP_CLEANUP_TIMEOUT_MS);
  } catch (error) {
    // Chrome may close the transport before acknowledging Browser.close. The
    // bounded child-exit proof below is the authoritative shutdown result.
    browserCloseError = new Error(`Browser.close failed: ${reason(error)}`);
  }

  try {
    await waitForChildExit(chrome.child, CHILD_EXIT_TIMEOUT_MS, 'after Browser.close');
  } catch {
    await terminateChild(chrome.child);
  }

  try {
    await chrome.client.close();
  } catch (error) {
    if (chrome.child.exitCode === null && (chrome.child.signalCode ?? null) === null) {
      throw new AggregateError(
        [browserCloseError, error].filter((value): value is Error => value instanceof Error),
        'Chrome exited neither through Browser.close nor bounded process escalation',
      );
    }
  }

  if (chrome.child.exitCode === null && (chrome.child.signalCode ?? null) === null) {
    throw new AggregateError(
      [browserCloseError].filter((value): value is Error => value instanceof Error),
      'Chrome remained alive after Browser.close, SIGTERM, and SIGKILL deadlines',
    );
  }
}

export class HostileSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null;

  send(): void {}

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'hostile close' });
  }
}

export function hostileClient(socket: HostileSocket): CdpClient {
  const Constructor = CdpClient as unknown as new (transport: WebSocket) => CdpClient;
  return new Constructor(socket as unknown as WebSocket);
}

export class NonExitingChild extends EventEmitter {
  exitCode: number | null = null;
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (signal === 'SIGKILL') {
      this.exitCode = 137;
      queueMicrotask(() => this.emit('exit', 137, signal));
    }
    return true;
  }
}

/**
 * Refuse a profile directory the caller did not actually have.
 *
 * `mtg-tfot`, 2026-08-23. A rig whose temp directory was `undefined` handed
 * that through, template interpolation made it the four-letter string, and
 * chrome-headless-shell obligingly created `./undefined/` in whatever
 * directory the run started from — a `Default/` and a `DevToolsActivePort`
 * committed by nobody, in the repo root. Chrome does not have the concept of a
 * bad profile path: any string is a directory it will make.
 *
 * So the check is here rather than at each of the thirty-odd call sites, and it
 * is a throw rather than a fallback. A rig that lost its temp directory has
 * lost the thing it cleans up in `finally`, and a default profile path would
 * hide that by writing somewhere nobody deletes. An absolute path is required
 * for the same reason: a relative one is measured from the cwd of whichever
 * runner spawned the process, which is how this landed in the repo root rather
 * than in `/tmp`.
 */
function assertProfileDirectory(userDataDir: string): void {
  if (typeof userDataDir !== 'string' || userDataDir.trim() === '') {
    throw new Error(
      `launchChrome needs a profile directory, and was given ${JSON.stringify(userDataDir)}. ` +
        'Chrome would create a directory of that name under the cwd.',
    );
  }
  if (!isAbsolute(userDataDir)) {
    throw new Error(
      `launchChrome needs an absolute profile directory, and was given ${JSON.stringify(userDataDir)}. ` +
        "A relative one is resolved against the runner's cwd, which is how one landed in the repo root.",
    );
  }
}

/**
 * Start chrome-headless-shell and hand back the child and a client on it.
 *
 * `switches` is for the one thing a rig can need that this function cannot
 * guess: which origin the browser is being asked to believe in.
 * `../../../slice/test/ui-phone-scroll.browser.test.ts` serves a live Vite app
 * and then navigates to it twice, once at `127.0.0.1` and once at a hostname
 * that has to resolve to that server, because the assertion it is making is
 * that a plain-HTTP origin — what a phone on the tailnet actually gets — is not
 * a secure context and the page works there anyway. That is a
 * `--host-resolver-rules` flag, it is meaningless to every other rig, and the
 * alternative was the copy of this function that rig used to carry.
 *
 * The flags above it are not negotiable and are not exposed: sandboxing, GPU,
 * the password store, the debugging port and the profile directory are the
 * harness's contract with its caller, not a rig's choice.
 */
export async function launchChrome(
  userDataDir: string,
  switches: readonly string[] = [],
): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly client: CdpClient;
  /**
   * The raw `ws://` DevTools endpoint this Chrome published, so a caller that
   * needs to hand this same running process to a second client (Stagehand's
   * `localBrowser.connect`, `mtg-onjme.1`) can, rather than launching a second
   * browser this harness never chose.
   */
  readonly debuggerUrl: string;
}> {
  assertProfileDirectory(userDataDir);
  const child = spawn(
    chromePath,
    [
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      // `mtg-a4kr`. Chrome consults the OS keyring before it issues the first
      // network request of a profile, and on a headless machine the D-Bus call
      // to `org.freedesktop.secrets` can go unanswered forever. What that looks
      // like from up here is `Page.navigate` never returning for any `http://`
      // URL -- not slowly, never -- while `about:blank`, `data:` and `file:`
      // answer in single-digit milliseconds and the server logs no request at
      // all. Every screenshot in `../../tools/shots.ts` failed that way, and
      // raising the call timeout to two minutes changed nothing, because there
      // was nothing to wait for. The basic store is a file in the profile
      // directory, which is a temporary directory that is deleted afterwards:
      // nothing here has a password worth keeping.
      '--password-store=basic',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      ...switches,
      'about:blank',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  child.stderr.setEncoding('utf8');
  try {
    const websocketUrl = await new Promise<string>((resolve, reject) => {
      let finished = false;
      const finish = (url?: string, error?: Error): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        child.stderr.removeListener('data', onData);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        if (url !== undefined) resolve(url);
        else reject(error ?? new Error('Chrome endpoint wait failed'));
      };
      const onData = (chunk: string): void => {
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk);
        if (match?.[1] !== undefined) finish(match[1]);
      };
      const onError = (error: Error): void =>
        finish(undefined, new Error(`Chrome failed to launch: ${error.message}`));
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
        finish(
          undefined,
          new Error(
            `Chrome exited before publishing DevTools (code ${String(code)}, signal ${String(signal)})`,
          ),
        );
      const timeout = setTimeout(
        () => finish(undefined, new Error('Chrome did not publish a DevTools endpoint within 8 seconds')),
        8_000,
      );
      child.stderr.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    return { child, client: await CdpClient.connect(websocketUrl), debuggerUrl: websocketUrl };
  } catch (error) {
    try {
      await terminateChild(child);
    } catch (terminationError) {
      throw new AggregateError(
        [error, terminationError],
        'Chrome launch failed and its child could not be terminated',
      );
    }
    throw error;
  }
}

export async function cleanupTarget(
  client: CdpClient,
  targetId: string,
  sessionId: string | null,
): Promise<void> {
  const errors: Error[] = [];
  if (sessionId !== null) {
    try {
      await client.call('Target.detachFromTarget', { sessionId }, undefined, CDP_CLEANUP_TIMEOUT_MS);
    } catch (error) {
      errors.push(new Error(`could not detach Chrome target ${targetId}: ${reason(error)}`));
    }
  }
  try {
    const closed = await client.call('Target.closeTarget', { targetId }, undefined, CDP_CLEANUP_TIMEOUT_MS);
    if (closed['success'] === false) {
      errors.push(new Error(`Chrome refused to close target ${targetId}`));
    }
  } catch (error) {
    errors.push(new Error(`could not close Chrome target ${targetId}: ${reason(error)}`));
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `Chrome target ${targetId} cleanup failed`);
  }
}

/**
 * Load one page at one viewport, wait for it to settle, and evaluate one
 * expression against it.
 *
 * The settle predicate is the page's own: document complete, at least one drawn
 * element matching `settleSelector`, no animation running, and two more frames
 * after that. Reduced motion is emulated so a transition never decides a box.
 *
 * `reducedMotion` is that emulation, and it is an argument for one caller: the
 * motion layer (`../play/motion.browser.test.ts`) has to be able to ask what a
 * viewer who did *not* ask for less motion is shown, and a page measured under
 * the reduce query can only ever answer that nothing moved. Every other caller
 * measures a box and wants the emulation, so it stays the default.
 *
 * `settleSelector` defaults to a play face because every caller but one measures
 * the played table. A page that draws no play face — the card gallery, which
 * `../card-fit.browser.test.ts` measures — would otherwise wait for a selector
 * it can never satisfy and time out, so the one thing that varies between
 * surfaces is an argument rather than a second copy of this function.
 *
 * `device` is what the browser is being told it *is*, as opposed to what it is
 * being shown. It is grouped rather than added to the tail because the two
 * fields are one fact: a phone is a touch device with a mobile viewport, and a
 * landscape phone is 844 CSS px wide, which is desktop width by every rule this
 * function had. `../play/landscape-phone.browser.test.ts` is the caller that
 * needed to say so, and what it needed it for is the 44px touch floor on the
 * step bar. Both fields default to what every existing caller already got.
 */
export interface EmulatedDevice {
  /** Whether Chrome treats the override as a mobile viewport; width-derived by default. */
  readonly mobile?: boolean;
  /** What `pointer` and `any-pointer` answer; `fine` unless a rig says otherwise. */
  readonly pointer?: 'fine' | 'coarse';
  readonly safeArea?: SafeAreaInsets;
}

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const STILL_SHEET = '*, *::before, *::after { transition: none !important; animation: none !important; }';

/**
 * Wraps a measurement expression that MUTATES the page, so what it moves lands
 * before it is read.
 *
 * Every rig here emulates `prefers-reduced-motion: reduce`, and the app answers
 * that with `transition-duration: 1ms !important` on `*` — which is not zero.
 * `transition-property` is `all` by default, so any mutation an expression makes
 * (setting `data-ask`, clearing `data-empty`, an inline style) starts a 1ms
 * transition on every interpolable property it moved, and the expression is
 * synchronous: it reads the value at t=0, which is the value from before the
 * mutation. Forcing layout does not help — nothing is stale, the transition is
 * genuinely at its start — and there is no CDP switch for it, because the
 * 1ms is the app's own answer to the motion query the rig sets.
 *
 * The failure is silent and reads as a fact about the layout: an inline
 * `flex-grow: 5` on a zone came back as a computed `0`, and a rule that was
 * doing its job looked like a no-op for an afternoon.
 *
 * It is opt-in rather than something `measurePage` always does, because
 * `../play/motion.browser.test.ts` and `../play/arrival-marks.browser.test.ts`
 * measure the motion itself: a rig that silenced every page would hand the
 * first one a green "a viewer who asked for no motion got none" that was about
 * the rig, and the second one nothing to look at. An expression that reads a
 * page it did not touch does not need this.
 */
export function stillPage(expression: string): string {
  return `(() => {
    const sheet = document.createElement('style');
    sheet.dataset['mtgStill'] = 'true';
    sheet.textContent = ${JSON.stringify(STILL_SHEET)};
    document.head.append(sheet);
    void document.documentElement.offsetHeight;
    return (${expression});
  })()`;
}

export async function measurePage(
  client: CdpClient,
  file: string,
  width: number,
  height: number,
  expression: string,
  label: string,
  settleSelector = ".mtg-slot[data-slot='play'] > .mtg-card",
  reducedMotion = true,
  device: EmulatedDevice = {},
): Promise<Record<string, unknown>> {
  const mobile = device.mobile ?? width < 500;
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile },
      sessionId,
    );
    if (device.safeArea !== undefined) {
      const { top, right, bottom, left } = device.safeArea;
      await client.call(
        'Emulation.setSafeAreaInsetsOverride',
        {
          insets: {
            top,
            right,
            bottom,
            left,
            topMax: top,
            rightMax: right,
            bottomMax: bottom,
            leftMax: left,
          },
        },
        sessionId,
      );
    }
    // The pointer features are stated only where a rig asked for them: Chrome
    // derives its own from the device metrics above, and overriding that for
    // every caller would re-answer the query on the phone-width rigs that
    // already get `coarse` from `mobile: true`.
    const pointer =
      device.pointer === undefined
        ? []
        : [
            { name: 'pointer', value: device.pointer },
            { name: 'any-pointer', value: device.pointer },
          ];
    await client.call(
      'Emulation.setEmulatedMedia',
      {
        features: [
          { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
          ...pointer,
        ],
      },
      sessionId,
    );
    if (device.pointer === 'coarse') {
      await client.call('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
    }
    const navigation = await client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    if (navigation['errorText'] !== undefined) {
      throw new Error(
        `Chrome could not load ${label} at ${String(width)}x${String(height)}: ${String(navigation['errorText'])}`,
      );
    }
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      client.call(
        'Runtime.evaluate',
        {
          expression: `new Promise((resolve) => {
            const check = () => {
              const faces = document.querySelectorAll(${JSON.stringify(settleSelector)}).length;
              const moving = document.getAnimations().filter((animation) =>
                animation.playState === 'pending' || animation.playState === 'running'
              ).length;
              if (document.readyState === 'complete' && faces > 0 && moving === 0) {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve({
                  readyState: document.readyState,
                  faces,
                  moving,
                })));
                return;
              }
              requestAnimationFrame(check);
            };
            check();
          })`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        8_000,
      ),
      new Promise<never>((_resolve, reject) => {
        settleTimer = setTimeout(
          () =>
            reject(
              new Error(
                `Chrome did not settle ${label} at ${String(width)}x${String(height)} from ${file} within 7 seconds; waiting for document complete, at least one ${settleSelector}, zero running animations, and two animation frames`,
              ),
            ),
          7_000,
        );
      }),
    ]).finally(() => {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
    });
    if (settled['exceptionDetails'] !== undefined) {
      throw new Error(
        `Chrome failed while settling ${label} at ${String(width)}x${String(height)}: ${JSON.stringify(settled['exceptionDetails'])}`,
      );
    }
    if (mobile) {
      const tag = await client.call(
        'Runtime.evaluate',
        {
          expression: `document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null`,
          returnByValue: true,
        },
        sessionId,
      );
      const content = (tag['result'] as { readonly value?: string | null } | undefined)?.value ?? null;
      const missing =
        content === null || !content.includes('width=device-width')
          ? 'width=device-width'
          : device.safeArea !== undefined && !content.includes('viewport-fit=cover')
            ? 'viewport-fit=cover'
            : null;
      if (missing !== null) {
        throw new Error(
          `${label} at ${String(width)}x${String(height)} emulates a mobile device, but ${file} has ${content === null ? 'no viewport meta tag' : `a viewport meta tag without ${missing} ("${content}")`}; serve <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"> or Chrome lays the page out at its 980px fallback${missing === 'viewport-fit=cover' ? ' and every safe-area inset reads zero' : ''}`,
        );
      }
    }
    const measured = await client.call('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (measured['exceptionDetails'] !== undefined) {
      throw new Error(`${label} measurement failed: ${JSON.stringify(measured['exceptionDetails'])}`);
    }
    return (measured['result'] as { readonly value?: Record<string, unknown> } | undefined)?.value ?? {};
  } finally {
    await cleanupTarget(client, targetId, sessionId);
  }
}

/**
 * Wired here rather than left for each caller to opt into, for the reason
 * `installOrphanGuard`'s docstring gives: a fixture-level opt-in only guards
 * the fixtures that remembered to add it, and the whole finding behind
 * mtg-4by7l is that a killed run does not get to run fixture teardown at all.
 * Every module that can launch Chrome imports this file, so importing it is
 * what turns the guard on.
 */
installOrphanGuard();
