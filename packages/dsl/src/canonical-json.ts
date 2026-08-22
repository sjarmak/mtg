/**
 * The workspace's one canonical JSON serializer.
 *
 * It is the primitive under every "is this the same record?" question in the
 * DSL, and its callers split two ways. `cardFingerprint` and `@mtg/llm`'s
 * `fixtureKey` hash what it returns; `sortAbilities` and the duplicate checks
 * in `validate/` compare the strings directly. Both uses need the one property,
 * that equal values produce byte-identical output, and neither can afford the
 * output to move: a moved fingerprint silently un-dedupes a set, and a moved
 * fixture key orphans every recorded response behind it.
 *
 * `@mtg/llm` used to declare its own copy. The two were measured identical over
 * every recorded fixture in the checkout and every example card (mtg-bc2.135),
 * so the copy became this import. The arrow runs `@mtg/llm` -> `@mtg/dsl` and
 * cannot run the other way: `@mtg/ui` bundles `@mtg/dsl` for a browser, while
 * `@mtg/llm` reaches `node:fs`, `node:child_process` and the Anthropic SDK.
 *
 * It has a module of its own rather than a home in `fingerprint.ts` because two
 * callers sit *below* fingerprinting in the import graph: `abilities.ts` sorts
 * an ability list by it, and `card.ts` depends on `abilities.ts`, so a
 * `fingerprint.ts` home would close a cycle.
 */

/** JSON with recursively sorted object keys, so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * The `undefined` filter is redundant with `JSON.stringify`, which omits
 * undefined-valued members itself. It stays because both merged copies had it
 * and because it makes the intermediate value canonical too, not just the
 * string; dropping it is a separate change owing its own corpus run.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, v]) => [key, canonicalize(v)]));
}
