/**
 * Writes that reach the disk before the call returns.
 *
 * Three launchers write evidence somebody will read after the process is gone:
 * the two strength campaigns (`./stage-strength-artifacts.ts`,
 * `./bot-strength-artifacts.ts`) and the gameplay recorder
 * (`./gameplay-recorder.ts`). Each wants the same two promises. A file is
 * created exclusively, so a second run never overwrites the first's evidence,
 * and its bytes are fsynced before the descriptor closes, so a machine that
 * loses power a moment later still holds the record it said it held. The two
 * campaigns carried byte-identical private copies of `writeDurably`; this is
 * that function, once, with the append form the recorder's index needs beside
 * it.
 *
 * Nothing here retries or swallows: a path that already exists throws `EEXIST`
 * from `openSync` and the caller decides what that means.
 */
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';

/** Creates `path` exclusively, writes `body`, and fsyncs before closing. */
export function writeDurably(path: string, body: string): void {
  const descriptor = openSync(path, 'wx');
  try {
    writeSync(descriptor, body);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Appends `line` to `path`, creating it if needed, and fsyncs before closing. */
export function appendDurably(path: string, line: string): void {
  const descriptor = openSync(path, 'a');
  try {
    writeSync(descriptor, line);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Fsyncs a directory, which is what makes a freshly created entry durable on
 * the file systems that journal metadata separately from data.
 */
export function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
