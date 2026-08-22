/**
 * Typed failures. Every boundary in this package (network, file, SQLite,
 * remote JSON shape) throws one of these rather than a bare `Error`, so
 * callers can branch on the cause instead of matching message text.
 */

/** A request to an upstream service failed or returned an unusable response. */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`HTTP ${status} for ${url}: ${detail}`);
    this.name = 'HttpError';
  }
}

/** Remote JSON did not match the shape we validate at the boundary. */
export class RemoteShapeError extends Error {
  constructor(
    readonly url: string,
    readonly issues: string,
  ) {
    super(`Unexpected response shape from ${url}: ${issues}`);
    this.name = 'RemoteShapeError';
  }
}

/** A downloaded artifact did not match the size the catalog advertised. */
export class DownloadIntegrityError extends Error {
  constructor(
    readonly url: string,
    readonly expectedBytes: number,
    readonly actualBytes: number,
  ) {
    super(`Download of ${url} is ${actualBytes} bytes, catalog advertised ${expectedBytes}`);
    this.name = 'DownloadIntegrityError';
  }
}

/** The SQLite file on disk was written by an incompatible schema version. */
export class SchemaVersionError extends Error {
  constructor(
    readonly path: string,
    readonly found: number,
    readonly expected: number,
  ) {
    super(
      `Store at ${path} has schema version ${found}, this build expects ${expected}. ` +
        `Delete the file to re-ingest, or migrate it before reuse.`,
    );
    this.name = 'SchemaVersionError';
  }
}

/** Caller-supplied input (lab card, CLI argument) failed validation. */
export class InvalidInputError extends Error {
  constructor(
    readonly what: string,
    readonly issues: string,
  ) {
    super(`Invalid ${what}: ${issues}`);
    this.name = 'InvalidInputError';
  }
}

/** A thrown value reduced to the two fields a caller can act on. No stack: this
 *  crosses a process boundary as JSON, where a stack is noise at best. */
export interface ErrorPayload {
  readonly name: string;
  readonly message: string;
}

/**
 * Renders a thrown non-`Error` without being able to throw itself.
 *
 * This runs inside the CLI's last catch, so a throw here costs both guarantees
 * `--json` documents: the envelope on stdout and the human line on stderr. Each
 * fallback covers a value the one above it dies on. `JSON.stringify` is first
 * because it shows a plain object's contents where `String` gives
 * `[object Object]`; it throws on a BigInt or a circular structure. `String`
 * handles both of those, and throws in turn on a null-prototype object or a
 * `toString` that throws.
 */
function renderNonError(error: unknown): string {
  try {
    return String(JSON.stringify(error));
  } catch {
    try {
      return String(error);
    } catch {
      return `<unrenderable ${typeof error}>`;
    }
  }
}

/** Splits a thrown value into its class name and message, keeping the class name
 *  that lets a caller branch on the cause instead of matching message text. */
export function errorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'NonError', message: renderNonError(error) };
}

/** Renders a thrown value as a single-line string without losing the type. */
export function describeError(error: unknown): string {
  const { name, message } = errorPayload(error);
  return `${name}: ${message}`;
}
