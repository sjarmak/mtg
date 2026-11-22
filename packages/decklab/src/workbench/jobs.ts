/**
 * Builds, as jobs rather than as requests.
 *
 * A deck build is minutes of model calls — the standard-control scenario once
 * blew a five-minute timeout outright (`mtg-bc2.24.2`). Nothing survives being
 * held open that long: a browser fetch, a proxy hop and an HTTP keep-alive each
 * have their own opinion about when a silent connection is dead, and none of
 * them is the build's. So the request starts the work and returns an id, and the
 * page asks how it is going.
 *
 * That also makes the three states `mtg-yp33` asks for explicit rather than
 * inferred. A page reading a job's state draws "building", "failed, here is why"
 * or "here it is" from what the job says, instead of guessing from whether a
 * fetch is still open.
 *
 * ## One build at a time
 *
 * Deliberate, and the reason is money rather than concurrency. Every build
 * spends against a ceiling a person typed once at the launcher; two builds in
 * flight spend it twice, and a page with a button on it can start a second build
 * with one impatient click. Refusing the second is a sentence on screen; letting
 * it through is a bill. A queue would be the same problem with a delay.
 */
import type { DeckVariation } from './variation';

export type JobState = 'running' | 'done' | 'failed';

export interface JobStatus {
  readonly id: string;
  readonly state: JobState;
  /** What is being built, so a reload can say so without holding the criteria. */
  readonly name: string;
  readonly startedAt: string;
  /** Present exactly when `state` is `done`. */
  readonly variation?: DeckVariation;
  /** Present exactly when `state` is `failed`. */
  readonly error?: string;
}

export class BuildInFlightError extends Error {
  constructor(readonly runningId: string) {
    super(
      'a build is already running; every build spends against the ceiling this server was started with, ' +
        'so they run one at a time. Wait for it, or reload to see where it got to',
    );
    this.name = 'BuildInFlightError';
  }
}

export class JobNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no build ${id}`);
    this.name = 'JobNotFoundError';
  }
}

/**
 * The jobs this server has run since it started.
 *
 * In memory, and that is the right lifetime: a job is a *build in progress*, and
 * a build in progress does not survive the process that is running it. What has
 * to survive is the finished deck, and that goes to the `VariationStore` the
 * moment the build lands — before the job is marked done, so there is no window
 * where the page is told a deck exists that nothing has written down.
 */
export class JobBoard {
  readonly #jobs = new Map<string, JobStatus>();
  #running: string | undefined;

  get runningId(): string | undefined {
    return this.#running;
  }

  status(id: string): JobStatus {
    const job = this.#jobs.get(id);
    if (job === undefined) throw new JobNotFoundError(id);
    return job;
  }

  /**
   * Starts a build and returns immediately with the job that is running it.
   *
   * `run` is passed rather than the build's inputs so this class knows nothing
   * about decks: it is the lifecycle, and what it is a lifecycle *of* is the
   * caller's business. `save` runs inside the same settlement as the state
   * change, which is what keeps "done" and "written down" from being two facts
   * that can disagree.
   */
  start(
    id: string,
    name: string,
    now: () => Date,
    run: () => Promise<DeckVariation>,
    save: (variation: DeckVariation) => void,
  ): JobStatus {
    if (this.#running !== undefined) throw new BuildInFlightError(this.#running);

    const started: JobStatus = { id, state: 'running', name, startedAt: now().toISOString() };
    this.#jobs.set(id, started);
    this.#running = id;

    // Deliberately not awaited: the caller is answering an HTTP request. Every
    // path through this chain clears `#running` and settles the job, so a build
    // that throws cannot leave the board wedged with nothing running.
    void run()
      .then((variation) => {
        // Written before the job is marked done. A page told "done" and then
        // handed a 404 for the variation would be worse than a page still told
        // "building".
        save(variation);
        this.#jobs.set(id, { ...started, state: 'done', variation });
      })
      .catch((reason: unknown) => {
        this.#jobs.set(id, {
          ...started,
          state: 'failed',
          error: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => {
        this.#running = undefined;
      });

    return started;
  }
}
