/**
 * Canon data lives as JSON on disk, not as TypeScript literals, so the schemas
 * validate the same bytes a human edits. Reads go through here so the parse
 * failure names the file.
 */
import { readFileSync } from 'node:fs';
import type { z } from 'zod';

const DATA_DIR = new URL('../data/', import.meta.url);

export class CanonDataError extends Error {
  constructor(
    readonly file: string,
    message: string,
    options?: { cause: unknown },
  ) {
    super(`${file}: ${message}`, options);
    this.name = 'CanonDataError';
  }
}

function readJson(file: string): unknown {
  const url = new URL(file, DATA_DIR);
  let text: string;
  try {
    text = readFileSync(url, 'utf8');
  } catch (error: unknown) {
    throw new CanonDataError(file, 'could not be read', { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new CanonDataError(file, 'is not valid JSON', { cause: error });
  }
}

/** Reads and validates a canon file, throwing a located error on any mismatch. */
export function loadCanon<T>(file: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(readJson(file));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new CanonDataError(file, `failed schema validation — ${detail}`);
  }
  return parsed.data;
}
