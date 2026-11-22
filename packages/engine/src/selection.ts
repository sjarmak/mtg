/**
 * Whole-match backend selection.
 *
 * The route is policy and the backend is mechanism. A caller states one
 * backend id for generated content and one for each printed format it offers;
 * this function resolves that single id and asks only that backend whether it
 * can play the table. It deliberately does not search for a backend that says
 * yes. Searching would turn an explicit route into an invisible fallback, and
 * ADR-0001 section 9.2 forbids a fallback before the match just as firmly as it
 * forbids one halfway through it.
 *
 * `supports` is the capability boundary. In particular, a Forge backend asked
 * to play printed cards plus custom DSL cards owns the all-or-nothing
 * transpilation check and returns every rejection from it here. The neutral
 * package neither imports the DSL nor interprets a rejection; it preserves the
 * backend's reasons as data.
 */
import type { GameBackend } from './session';
import type { SessionSpec } from './table';
import type { ContentUnsupportedError } from './errors';

export interface BackendRoutes {
  /** Backend id used for every generated DSL set. Conventionally `kernel`. */
  readonly generated: string;
  /** Exact printed-format id to backend-id mapping. There is no wildcard. */
  readonly printed: Readonly<Record<string, string>>;
}

export type BackendSelectionError =
  | {
      readonly kind: 'route-missing';
      readonly content: string;
      readonly message: string;
    }
  | {
      readonly kind: 'backend-missing';
      readonly backend: string;
      readonly message: string;
    }
  | {
      readonly kind: 'duplicate-backend';
      readonly backend: string;
      readonly message: string;
    }
  | ContentUnsupportedError
  | {
      readonly kind: 'support-check-failed';
      readonly backend: string;
      readonly message: string;
    };

export type BackendSelection =
  | { readonly ok: true; readonly backend: GameBackend }
  | { readonly ok: false; readonly error: BackendSelectionError };

/** Selects the one backend that will own `table` for its entire lifetime. */
export async function routeBackend(
  table: SessionSpec,
  installed: readonly GameBackend[],
  routes: BackendRoutes,
): Promise<BackendSelection> {
  const duplicate = duplicateIdOf(installed);
  if (duplicate !== null) {
    return {
      ok: false,
      error: {
        kind: 'duplicate-backend',
        backend: duplicate,
        message: `backend id ${JSON.stringify(duplicate)} is installed more than once`,
      },
    };
  }

  const routed = routeOf(table, routes);
  if (!routed.ok) return routed;

  const selected = installed.find((backend) => backend.id === routed.backend);
  if (selected === undefined) {
    return {
      ok: false,
      error: {
        kind: 'backend-missing',
        backend: routed.backend,
        message: `route selected backend ${JSON.stringify(routed.backend)}, but it is not installed`,
      },
    };
  }

  let reasons: readonly string[];
  try {
    reasons = await selected.supports(table);
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: 'support-check-failed',
        backend: selected.id,
        message: `backend ${JSON.stringify(selected.id)} support check failed: ${messageOf(cause)}`,
      },
    };
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      error: {
        kind: 'content-unsupported',
        backend: selected.id,
        reasons: [...reasons],
        message: `backend ${JSON.stringify(selected.id)} refused this match with ${String(reasons.length)} named reasons`,
      },
    };
  }
  return { ok: true, backend: selected };
}

function duplicateIdOf(installed: readonly GameBackend[]): string | null {
  const ids = new Set<string>();
  for (const backend of installed) {
    if (ids.has(backend.id)) return backend.id;
    ids.add(backend.id);
  }
  return null;
}

type RouteResult =
  | { readonly ok: true; readonly backend: string }
  | { readonly ok: false; readonly error: Extract<BackendSelectionError, { kind: 'route-missing' }> };

function routeOf(table: SessionSpec, routes: BackendRoutes): RouteResult {
  if (table.content.kind === 'dsl-set') return { ok: true, backend: routes.generated };

  const format = table.content.format;
  const contentKind = table.content.kind;
  if (!Object.hasOwn(routes.printed, format)) {
    return {
      ok: false,
      error: {
        kind: 'route-missing',
        content: `${contentKind}:${format}`,
        message: `no backend route is configured for ${contentKind} format ${JSON.stringify(format)}`,
      },
    };
  }
  const backend = routes.printed[format];
  if (backend === undefined) {
    return {
      ok: false,
      error: {
        kind: 'route-missing',
        content: `${contentKind}:${format}`,
        message: `no backend route is configured for ${contentKind} format ${JSON.stringify(format)}`,
      },
    };
  }
  return { ok: true, backend };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
