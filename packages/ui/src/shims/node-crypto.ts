/**
 * Browser stand-in for `node:crypto`, wired up by this package's Vite config.
 *
 * Why it exists: `@mtg/dsl`'s barrel re-exports `fingerprint.ts`, which imports
 * `createHash` from `node:crypto`. Rollup resolves that binding while linking,
 * before it can tree-shake the unused module, so a browser build of anything
 * importing `@mtg/dsl` fails to link without a stand-in. Nothing in `@mtg/ui`
 * calls it: card fingerprinting is set-generation work that belongs on the Node
 * side, next to the file IO it feeds.
 *
 * It fails loudly rather than returning a fake digest. A wrong fingerprint that
 * looks right would corrupt set-uniqueness checks; an exception naming the call
 * site cannot.
 *
 * The proper fix is upstream in `@mtg/dsl`: move `cardFingerprint` and
 * `mechanicalFingerprint` behind a subpath export, or hash without `node:crypto`,
 * so the DSL barrel stays browser-safe. Reported rather than edited — that
 * package is not this one's to change.
 */

export function createHash(algorithm: string): never {
  throw new Error(
    `node:crypto.createHash(${JSON.stringify(algorithm)}) is not available in the browser bundle: ` +
      '@mtg/dsl card fingerprinting is a Node-side operation',
  );
}
