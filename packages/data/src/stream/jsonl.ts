/**
 * Streaming JSONL reader.
 *
 * `default_cards` is ~78 MB gzipped and several hundred MB decompressed; the
 * naive `JSON.parse(readFileSync(...))` dies on it. Everything here is a
 * stream: file → optional gunzip → line iterator, with constant memory
 * regardless of file size.
 *
 * Gzip is detected from the magic bytes rather than the extension, so plain
 * `.jsonl` fixtures and real `.jsonl.gz` downloads go through one code path.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export interface JsonlLine {
  /** 1-based physical line number, counting blank lines. Resume anchors on it. */
  readonly lineNumber: number;
  readonly text: string;
}

export interface ReadJsonlOptions {
  /** Skip lines whose number is <= this. 0 reads from the beginning. */
  readonly startLine?: number;
  readonly signal?: AbortSignal;
}

const GZIP_MAGIC = [0x1f, 0x8b] as const;

export async function isGzipFile(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return bytesRead === 2 && buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1];
  } finally {
    await handle.close();
  }
}

/**
 * Yields every non-blank line of a JSONL file (gzipped or plain).
 *
 * Blank lines advance `lineNumber` but are not yielded — trailing newlines are
 * normal in these files and are not records.
 */
export async function* readJsonlLines(
  path: string,
  options: ReadJsonlOptions = {},
): AsyncGenerator<JsonlLine, void, undefined> {
  const startLine = options.startLine ?? 0;
  const gzipped = await isGzipFile(path);
  const fileStream = createReadStream(path);
  const source: Readable = gzipped ? fileStream.pipe(createGunzip()) : fileStream;
  const lines = createInterface({ input: source, crlfDelay: Infinity });

  let lineNumber = 0;
  try {
    for await (const raw of lines) {
      lineNumber += 1;
      if (options.signal?.aborted === true) return;
      if (lineNumber <= startLine) continue;
      const text = raw.trim();
      if (text.length === 0) continue;
      yield { lineNumber, text };
    }
  } finally {
    lines.close();
    source.destroy();
    if (source !== fileStream) fileStream.destroy();
  }
}
