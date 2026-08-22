/**
 * Writing an export to disk: the `custom/{cards,editions,tokens}` layout Forge
 * documents for user content, plus the deck files the boot gate plays.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ForgeDeck } from './deck';
import { deckFileName, renderDeck } from './deck';
import type { ForgeFile, ForgeSetExport } from './transpile';

/** Writes one file, creating parent directories. Returns the absolute path. */
export function writeForgeFile(rootDir: string, file: ForgeFile): string {
  const path = join(rootDir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.contents, 'utf8');
  return path;
}

/** Writes edition, card scripts and token scripts under a `custom/` directory. */
export function writeForgeSet(customDir: string, exported: ForgeSetExport): string[] {
  const files = [exported.edition, ...exported.cards, ...exported.tokens];
  return files.map((file) => writeForgeFile(customDir, file));
}

/** Writes `.dck` files into Forge's constructed-decks directory. */
export function writeDecks(decksDir: string, decks: readonly ForgeDeck[]): string[] {
  mkdirSync(decksDir, { recursive: true });
  return decks.map((deck) => {
    const path = join(decksDir, deckFileName(deck));
    writeFileSync(path, renderDeck(deck), 'utf8');
    return path;
  });
}
