import { useCallback, useEffect, useState } from 'react';
import { BROWSER_BACKEND_PROTOCOL, isRecord } from './backend-gateway';

export const FORGE_LOADING_MESSAGE = 'Forge is still loading this format';

export type GatewayReadiness =
  | { readonly status: 'loading'; readonly retry: () => void }
  | { readonly status: 'ready' }
  | { readonly status: 'unknown' };

type GatewayReadinessState =
  | Exclude<GatewayReadiness, { readonly status: 'loading' }>
  | {
      readonly status: 'loading';
    };

interface GatewayReadinessRead {
  readonly format: string | null;
  readonly state: GatewayReadinessState;
}

export function useGatewayReadiness(format: string | null): GatewayReadiness {
  const [read, setRead] = useState<GatewayReadinessRead>({
    format: null,
    state: { status: 'unknown' },
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setRead({ format, state: { status: 'loading' } });
    setAttempt((current) => current + 1);
  }, [format]);

  useEffect(() => {
    if (format === null) {
      setRead({ format, state: { status: 'unknown' } });
      return undefined;
    }
    let live = true;
    const controller = new AbortController();
    setRead({ format, state: { status: 'loading' } });
    void fetch(`/engine-api/readiness?format=${encodeURIComponent(format)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return { status: 'unknown' } as const;
        if (!response.ok) return { status: 'loading' } as const;
        const body: unknown = await response.json();
        if (
          !isRecord(body) ||
          body['protocol'] !== BROWSER_BACKEND_PROTOCOL ||
          body['ok'] !== true ||
          body['format'] !== format ||
          typeof body['ready'] !== 'boolean'
        )
          return { status: 'unknown' } as const;
        return { status: body['ready'] ? 'ready' : 'loading' } as const;
      })
      .catch(() => ({ status: 'loading' }) as const)
      .then((next) => {
        if (live) setRead({ format, state: next });
      });
    return (): void => {
      live = false;
      controller.abort();
    };
  }, [attempt, format]);

  const state: GatewayReadinessState =
    read.format === format ? read.state : { status: format === null ? 'unknown' : 'loading' };
  return state.status === 'loading' ? { status: 'loading', retry } : state;
}
