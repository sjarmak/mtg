/** One app-lifetime local snapshot; no polling or draft-time model service. */
import { useEffect, useState } from 'react';
import { advisorModelIdentityText, readAdvisorCalibration } from '@mtg/draft-export';
import type { AdvisorCalibration } from '@mtg/draft-export';
import { sha256Text } from '../analysis/calibration-read';

export type AdvisorCalibrationState =
  | { readonly status: 'loading' }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: AdvisorCalibration };

export async function loadAdvisorCalibration(
  url: string,
  catalogSha256: string,
): Promise<AdvisorCalibrationState> {
  try {
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (response.status === 404) return { status: 'absent' };
    if (!response.ok) throw new Error(`Calibration request failed (${response.status})`);
    // Vite's absent public asset fallback serves the app shell with status 200.
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return { status: 'absent' };
    if (!type.includes('application/json')) throw new Error('Calibration response is not JSON');
    const snapshot = await readAdvisorCalibration(
      await response.json(),
      {
        catalogSha256,
        modelSha256: await sha256Text(advisorModelIdentityText()),
      },
      sha256Text,
    );
    return { status: 'ready', snapshot };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

export function useAdvisorCalibration(
  url: string | undefined,
  catalogSha256: string | undefined,
): AdvisorCalibrationState {
  const key = JSON.stringify([url, catalogSha256]);
  const [read, setRead] = useState<{ key: string; state: AdvisorCalibrationState } | null>(null);
  useEffect(() => {
    if (url === undefined || catalogSha256 === undefined) return;
    let live = true;
    void loadAdvisorCalibration(url, catalogSha256).then((state) => {
      if (live) setRead({ key, state });
    });
    return () => {
      live = false;
    };
  }, [url, catalogSha256, key]);
  if (url === undefined) return { status: 'absent' };
  return read?.key === key ? read.state : { status: 'loading' };
}
