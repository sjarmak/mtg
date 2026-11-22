/** Strict reader for exact `.dck` inputs used by reproducible Forge campaigns. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeckRef } from '@mtg/engine';

export interface LoadedForgeDeckFile {
  readonly path: string;
  readonly sha256: string;
  readonly deck: DeckRef;
}

const ENTRY = /^([1-9][0-9]*) ([^|\r\n]+?)(?:\|([A-Z0-9]+))?$/u;

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error('Forge deck file is not valid UTF-8.', { cause });
  }
}

function linesOf(body: string): readonly string[] {
  const lines = body.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (lines.some((line) => line === '')) throw new Error('Forge deck file contains an empty line.');
  return lines;
}

/** Hash the original bytes, then parse only the canonical metadata/main subset. */
export function loadForgeDeckFile(path: string): LoadedForgeDeckFile {
  const absolutePath = resolve(path);
  const bytes = readFileSync(absolutePath);
  const lines = linesOf(decode(bytes));
  if (lines[0] !== '[metadata]') throw new Error('Forge deck file must start with [metadata].');
  if (lines[1] === undefined || !lines[1].startsWith('Name=')) {
    throw new Error('Forge deck file must contain one Name metadata field.');
  }
  const name = lines[1].slice('Name='.length);
  if (name.trim() !== name || name.length === 0)
    throw new Error('Forge deck Name must be nonempty and trimmed.');
  if (lines[2] !== '[main]') throw new Error('Forge deck file must contain [main] after its Name.');
  const entryLines = lines.slice(3);
  if (entryLines.length === 0) throw new Error('Forge deck main section must contain at least one card.');

  const counts = new Map<string, number>();
  for (const line of entryLines) {
    if (line.startsWith('[')) throw new Error(`Forge deck file has an unsupported section: ${line}`);
    const match = ENTRY.exec(line);
    if (match === null) {
      if (/\|[a-z]/u.test(line)) throw new Error(`Forge deck entry has an invalid set code: ${line}`);
      if (/^[0-9]+ /u.test(line)) throw new Error(`Forge deck entry has an invalid count: ${line}`);
      throw new Error(`Invalid Forge card entry: ${line}`);
    }
    const count = Number(match[1]);
    if (!Number.isSafeInteger(count)) throw new Error(`Forge deck entry has an invalid count: ${line}`);
    const cardName = match[2]!;
    if (cardName.trim() !== cardName) throw new Error(`Invalid Forge card entry: ${line}`);
    const total = (counts.get(cardName) ?? 0) + count;
    if (!Number.isSafeInteger(total)) throw new Error(`Forge deck count exceeds a safe integer: ${cardName}`);
    counts.set(cardName, total);
  }

  return {
    path: absolutePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    deck: { name, cards: [...counts].map(([cardName, count]) => ({ name: cardName, count })) },
  };
}
