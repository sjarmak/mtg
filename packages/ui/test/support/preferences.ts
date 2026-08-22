/**
 * The stored view preferences, cleared between tests.
 *
 * Both collapsing columns keep their answer in `localStorage` on purpose
 * (`src/routes/play/collapse-preference.ts`): a press has to survive the reload
 * a phone performs whenever it feels like it. jsdom keeps one store for the
 * whole file, so a test that presses a disclosure hands its answer to every test
 * after it — which is how one press in `beat-motion.test.ts` shut the ask column
 * for two later cases that never touched it, and how the first shut table in
 * `ask-flyout.test.ts` left the next `openTable` already shut.
 *
 * Reached structurally because the workspace tsconfig has no `lib: dom`
 * (`src/app/mount.ts` records why), and absent rather than fatal when there is
 * no store at all, so a node-environment file can call this without knowing.
 */
export function clearPreferences(): void {
  const host = globalThis as { readonly localStorage?: unknown };
  if (typeof host.localStorage !== 'object' || host.localStorage === null) return;
  (host.localStorage as { clear(): void }).clear();
}
