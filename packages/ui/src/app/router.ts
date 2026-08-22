/**
 * A hash router in one file.
 *
 * A handful of modes over one app, so a routing dependency would be most of a
 * kilobyte of matcher for one switch. Hashes also mean the built app is
 * a static file that works from `file://` and from any subpath, which matters
 * because these pages get opened straight out of an `out/` run directory.
 *
 * Shape: `#/<mode>?<params>` — `#/replay?game=3`. An unrecognized mode falls
 * back to the default rather than throwing; a stale bookmark should land
 * somewhere useful, and nothing downstream depends on the URL being valid.
 *
 * No `lib: dom` is available under the workspace tsconfig, so the browser is
 * reached through the narrow `HashSource` interface below rather than through
 * ambient `window`.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';

export const UI_MODES = ['play', 'draft', 'deck', 'analysis', 'replay', 'cards'] as const;
export type UiMode = (typeof UI_MODES)[number];

export const DEFAULT_MODE: UiMode = 'play';

export const MODE_LABELS: Readonly<Record<UiMode, string>> = {
  play: 'Play',
  draft: 'Draft',
  deck: 'Deck',
  analysis: 'Analysis',
  replay: 'Replay',
  cards: 'Cards',
};

export interface UiRoute {
  readonly mode: UiMode;
  readonly params: Readonly<Record<string, string>>;
}

export interface HashSource {
  readonly location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/** The browser's hash, or `null` when this is not running in one. */
export function hashSource(): HashSource | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as Partial<HashSource>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  if (typeof partial.location !== 'object' || partial.location === null) return null;
  if (typeof partial.location.hash !== 'string') return null;
  return candidate as HashSource;
}

function isMode(value: string): value is UiMode {
  return (UI_MODES as readonly string[]).includes(value);
}

/** `#/replay?game=3` to a route. Unknown modes resolve to `DEFAULT_MODE`. */
export function parseHash(hash: string): UiRoute {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = trimmed.split('?', 2);
  const segment = pathPart.replace(/^\/+/, '').split('/')[0] ?? '';
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) params[key] = value;
  return { mode: isMode(segment) ? segment : DEFAULT_MODE, params };
}

/** A route to the hash that reproduces it. Params are sorted for stable URLs. */
export function routeHash(route: UiRoute): string {
  const entries = Object.entries(route.params)
    .filter(([, value]) => value.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(entries).toString();
  return query.length === 0 ? `#/${route.mode}` : `#/${route.mode}?${query}`;
}

export interface UiRouter {
  readonly route: UiRoute;
  /** Replaces the whole route. */
  readonly navigate: (route: UiRoute) => void;
  /** Switches mode, dropping the previous mode's params. */
  readonly goTo: (mode: UiMode) => void;
  /** Merges params into the current route; an empty string removes a key. */
  readonly setParams: (params: Readonly<Record<string, string>>) => void;
}

const EMPTY_HASH = '';

function subscribeToHash(onChange: () => void): () => void {
  const source = hashSource();
  if (source === null) return () => undefined;
  source.addEventListener('hashchange', onChange);
  return () => {
    source.removeEventListener('hashchange', onChange);
  };
}

function currentHash(): string {
  return hashSource()?.location.hash ?? EMPTY_HASH;
}

/** Subscribes to the location hash and exposes the parsed route. */
export function useHashRoute(): UiRouter {
  const hash = useSyncExternalStore(subscribeToHash, currentHash, () => EMPTY_HASH);
  const route = useMemo(() => parseHash(hash), [hash]);
  const navigate = useCallback((next: UiRoute): void => {
    const source = hashSource();
    if (source === null) {
      throw new Error('navigate() needs a browser location; this host has no window');
    }
    source.location.hash = routeHash(next);
  }, []);
  const goTo = useCallback(
    (mode: UiMode): void => {
      navigate({ mode, params: {} });
    },
    [navigate],
  );
  const setParams = useCallback(
    (params: Readonly<Record<string, string>>): void => {
      const merged: Record<string, string> = { ...route.params, ...params };
      for (const [key, value] of Object.entries(merged)) {
        if (value.length === 0) delete merged[key];
      }
      navigate({ mode: route.mode, params: merged });
    },
    [navigate, route.mode, route.params],
  );
  return { route, navigate, goTo, setParams };
}
