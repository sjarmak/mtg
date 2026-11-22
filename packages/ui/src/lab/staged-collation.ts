/**
 * The collation a staged set document carries, read as a sampler's input.
 *
 * The reader itself is `@mtg/deckbuild`'s `read-collation.ts`, which is where it
 * moved when the Draftmancer exporter needed the same read (`mtg-rbw6`). It
 * stays reachable under these names because they are what this package's public
 * surface has always called them, and because a route reading a staged document
 * is the caller it was written for.
 */
export { readStagedCollation } from '@mtg/deckbuild';
export type { StagedCollation } from '@mtg/deckbuild';
