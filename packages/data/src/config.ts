/**
 * Ingest configuration: endpoints, request etiquette, and on-disk locations.
 *
 * Every constant here is sourced from `docs/research/prior-art-data-sources.md`
 * §1.1–1.2 (Scryfall bulk semantics, hard rate limits, required headers) and
 * §2 (MTGJSON vocabulary files). Changing one means re-reading that section.
 */

/** Scryfall bulk-data kinds this package knows how to ingest. */
export const BULK_KINDS = ['oracle_cards', 'default_cards', 'rulings'] as const;
export type BulkKind = (typeof BULK_KINDS)[number];

/** Bulk kinds whose lines are Scryfall card objects (vs ruling objects). */
export const CARD_BULK_KINDS: readonly BulkKind[] = ['oracle_cards', 'default_cards'];

/** Row provenance discriminator: real upstream data vs cards this lab generated. */
export const SOURCES = ['scryfall', 'lab'] as const;
export type Source = (typeof SOURCES)[number];

export const SCRYFALL_BULK_ENDPOINT = 'https://api.scryfall.com/bulk-data';

export const MTGJSON_BASE = 'https://mtgjson.com/api/v5';

/**
 * Scryfall requires an accurate, descriptive User-Agent and an explicit Accept
 * header on every `api.scryfall.com` request, and forbids letting the HTTP
 * library pick one ("Do not allow HTTP libraries to choose the header for
 * you"). Pinned here, sent on every request this package makes.
 */
export const USER_AGENT = 'mtg-lab/0.1 (+https://github.com/sjarmak/mtg; non-commercial MTG design lab)';

export const ACCEPT_HEADER = '*/*';

/**
 * Minimum spacing between requests, per host. Scryfall documents 10 requests
 * per second (100 ms) for non-search endpoints as a hard limit, and states the
 * `*.scryfall.io` file origins are not rate limited — we still leave a small
 * gap there rather than hammering a CDN. MTGJSON publishes no limit; 200 ms is
 * simple politeness for three small files.
 */
export const HOST_MIN_INTERVAL_MS: Readonly<Record<string, number>> = {
  'api.scryfall.com': 100,
  'data.scryfall.io': 20,
  'mtgjson.com': 200,
};

export const DEFAULT_MIN_INTERVAL_MS = 250;

/** Scryfall: "HTTP 429 ⇒ access limited for 30 seconds." Respect it literally. */
export const RATE_LIMIT_COOLDOWN_MS = 30_000;

export const DEFAULT_MAX_RETRIES = 3;

/** Relative to the repo root; both are gitignored. */
export const DEFAULT_CACHE_DIR = 'data/cache';
export const DEFAULT_DB_PATH = 'data/store/mtg.sqlite';

/** Lines committed per SQLite transaction; also the checkpoint granularity. */
export const DEFAULT_BATCH_SIZE = 1_000;

/** Upper bound on rows kept in `ingest_reject`; the run counter stays exact. */
export const DEFAULT_REJECT_LOG_LIMIT = 1_000;

/**
 * Attribution required by the sources this package ingests
 * (`docs/research/prior-art-data-sources.md` §6). Printed by `cli.ts stats` so
 * the envelope travels with the data rather than living only in a doc.
 */
export const ATTRIBUTION = [
  'Card data from Scryfall (https://scryfall.com), used under their API guidelines.',
  'Vocabulary and reference-set data from MTGJSON (https://mtgjson.com), MIT licensed.',
  'Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
  'This lab is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards.',
] as const;
