/**
 * Per-verification memoization of retained evidence.
 *
 * One admission verifies every script qualification it names, each of them
 * twice (once per controller), and every qualification re-derives itself
 * from the same shared files: the coverage report, the coverage plan and the
 * controller contracts with the bridge source they bind. Read, hashed and
 * parsed afresh each time, `commander-precons`' 1,981 qualifications turned
 * one 12.7 MB report into 3,962 JSON parses, and admitting every installed
 * format kept a launcher busy for over an hour before its port bound.
 *
 * Nothing here relaxes a check. `memoizedReader` reads each path once for
 * the life of the reader, so every later check runs against exactly the
 * bytes the first one did; the digests and parses below are keyed by those
 * byte objects, so a result is reused only for the very bytes it was
 * computed from, and is dropped with them.
 */
import { createHash } from 'node:crypto';

type Bytes = string | Uint8Array;
type Reader = (path: string) => Bytes;

const MEMOIZED = new WeakMap<Reader, number>();
let nextReaderId = 0;

/** Reads each path once; wrapping an already memoized reader returns it unchanged. */
export function memoizedReader(read: Reader): Reader {
  if (MEMOIZED.has(read)) return read;
  const byPath = new Map<string, Bytes>();
  const memoized: Reader = (path) => {
    const cached = byPath.get(path);
    if (cached !== undefined) return cached;
    const bytes = read(path);
    byPath.set(path, bytes);
    return bytes;
  };
  MEMOIZED.set(memoized, nextReaderId++);
  return memoized;
}

/**
 * Names a memoized reader, so a result that depends on what a reader returns
 * is keyed by that reader as well as by the bytes it was asked about.
 */
export function readerId(read: Reader): number {
  const id = MEMOIZED.get(read);
  if (id === undefined) throw new Error('readerId requires a memoized reader');
  return id;
}

const DIGESTS = new WeakMap<Uint8Array, string>();

export function digestOf(bytes: Bytes): string {
  if (typeof bytes === 'string') return createHash('sha256').update(bytes).digest('hex');
  const cached = DIGESTS.get(bytes);
  if (cached !== undefined) return cached;
  const digest = createHash('sha256').update(bytes).digest('hex');
  DIGESTS.set(bytes, digest);
  return digest;
}

const RESULTS = new WeakMap<Uint8Array, Map<string, unknown>>();

/**
 * The result of `compute` over these bytes under `key`, computed once per
 * byte object. A throw is not remembered, so a failing check fails every
 * time it is asked. String bytes are not memoized.
 */
export function memoizedOver<T>(bytes: Bytes, key: string, compute: () => T): T {
  if (typeof bytes === 'string') return compute();
  let results = RESULTS.get(bytes);
  if (results === undefined) {
    results = new Map();
    RESULTS.set(bytes, results);
  }
  if (results.has(key)) return results.get(key) as T;
  const value = compute();
  results.set(key, value);
  return value;
}
