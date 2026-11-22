/**
 * The two decisions `build.ts` makes before it spawns Vite, held apart from it.
 *
 * Same split as `play-args.ts` and for the same reason: the launcher itself
 * stages files and spawns a process, so a test that imports it either does both
 * or mocks both. What is worth pinning is smaller than that — which set the
 * build is told to paint with, and that the flags a person typed still arrive.
 */
import type { SymbolSet } from '../src/card/symbols';

export function buildEnv(set: SymbolSet, setIcons: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, MTG_SYMBOL_SET: set, MTG_SET_ICONS: setIcons };
}

/** `npx vite build`, plus whatever the caller typed after the script name. */
export function viteBuildArgs(argv: readonly string[]): readonly string[] {
  return ['vite', 'build', ...argv];
}
