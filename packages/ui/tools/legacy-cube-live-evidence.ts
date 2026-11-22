import type { CdpEvent } from '../test/support/chrome-driver';

export interface GatewayResponse {
  readonly method: string;
  readonly status: number;
  readonly url: string;
}

function successful(entry: GatewayResponse): boolean {
  return entry.status >= 200 && entry.status < 300;
}

/** Applies one explicit wall-clock budget to both visible match launches. */
export function matchOpeningBudgetProblem(
  freshMs: number,
  persistedMs: number,
  maximumMs: number,
): string | null {
  if (freshMs > maximumMs) {
    return `fresh launch reached its opening hand in ${String(freshMs)}ms, exceeding the ${String(maximumMs)}ms budget`;
  }
  if (persistedMs > maximumMs) {
    return `persisted-deck relaunch reached its opening hand in ${String(persistedMs)}ms, exceeding the ${String(maximumMs)}ms budget`;
  }
  return null;
}

/** Refuse browser proof that lacks its required launches or leaves an opened session live. */
export function gatewayLifecycleProblem(
  responses: readonly GatewayResponse[],
  minimumOpens = 1,
): string | null {
  const opens = responses.filter(
    (entry) =>
      successful(entry) && entry.method === 'POST' && new URL(entry.url).pathname === '/engine-api/sessions',
  ).length;
  const moves = responses.filter(
    (entry) =>
      successful(entry) &&
      entry.method === 'POST' &&
      new URL(entry.url).pathname.startsWith('/engine-api/sessions/'),
  ).length;
  const closes = responses.filter(
    (entry) =>
      successful(entry) &&
      entry.method === 'DELETE' &&
      new URL(entry.url).pathname.startsWith('/engine-api/sessions/'),
  ).length;
  if (opens < minimumOpens) {
    return `browser recorded ${String(opens)} successful gateway open response${opens === 1 ? '' : 's'} but the journey requires at least ${String(minimumOpens)}`;
  }
  if (moves === 0) return 'browser advanced but recorded no successful gateway move response';
  if (closes !== opens) {
    return `browser recorded ${String(opens)} successful gateway open responses but ${String(closes)} successful gateway close response${closes === 1 ? '' : 's'}`;
  }
  return null;
}

interface RequestRecord {
  readonly method: string;
  readonly url: string;
}

/** Join CDP's separate request and response events into attributable HTTP evidence. */
export function gatewayResponsesOf(events: readonly CdpEvent[]): readonly GatewayResponse[] {
  const requests = new Map<string, RequestRecord>();
  const responses: GatewayResponse[] = [];
  for (const event of events) {
    const requestId = event.params['requestId'];
    if (typeof requestId !== 'string') continue;
    if (event.method === 'Network.requestWillBeSent') {
      const request = event.params['request'];
      if (typeof request !== 'object' || request === null) continue;
      const fields = request as Record<string, unknown>;
      if (typeof fields['method'] !== 'string' || typeof fields['url'] !== 'string') continue;
      requests.set(requestId, { method: fields['method'], url: fields['url'] });
      continue;
    }
    if (event.method !== 'Network.responseReceived') continue;
    const request = requests.get(requestId);
    const response = event.params['response'];
    if (request === undefined || typeof response !== 'object' || response === null) continue;
    const fields = response as Record<string, unknown>;
    if (typeof fields['status'] !== 'number' || !request.url.includes('/engine-api/')) continue;
    responses.push({ method: request.method, status: fields['status'], url: request.url });
  }
  return responses;
}
