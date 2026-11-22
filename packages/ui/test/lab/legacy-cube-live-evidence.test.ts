import { describe, expect, it } from 'vitest';
import type { CdpEvent } from '../../test/support/chrome-driver';
import {
  gatewayLifecycleProblem,
  gatewayResponsesOf,
  matchOpeningBudgetProblem,
} from '../../tools/legacy-cube-live-evidence';

function event(method: string, params: Record<string, unknown>): CdpEvent {
  return { method, params, sessionId: 'page-1' };
}

describe('Legacy Cube live gateway evidence', () => {
  it('fails the timed journey when either visible launch exceeds its explicit budget', () => {
    expect(matchOpeningBudgetProblem(3_999, 4_000, 4_000)).toBeNull();
    expect(matchOpeningBudgetProblem(4_001, 2_600, 4_000)).toBe(
      'fresh launch reached its opening hand in 4001ms, exceeding the 4000ms budget',
    );
    expect(matchOpeningBudgetProblem(3_000, 4_500, 4_000)).toBe(
      'persisted-deck relaunch reached its opening hand in 4500ms, exceeding the 4000ms budget',
    );
  });

  it('refuses successful opens that have no matching successful close', () => {
    const open = { method: 'POST', status: 200, url: 'http://127.0.0.1/engine-api/sessions' };
    const move = { method: 'POST', status: 200, url: 'http://127.0.0.1/engine-api/sessions/token-2' };
    const close = { method: 'DELETE', status: 200, url: 'http://127.0.0.1/engine-api/sessions/token-2' };

    expect(gatewayLifecycleProblem([open, open, move, close])).toBe(
      'browser recorded 2 successful gateway open responses but 1 successful gateway close response',
    );
    expect(gatewayLifecycleProblem([open, open, close, move, close])).toBeNull();
  });

  it('can require a fresh second session for a persisted-deck relaunch', () => {
    const open = { method: 'POST', status: 200, url: 'http://127.0.0.1/engine-api/sessions' };
    const move = { method: 'POST', status: 200, url: 'http://127.0.0.1/engine-api/sessions/token-2' };
    const close = { method: 'DELETE', status: 200, url: 'http://127.0.0.1/engine-api/sessions/token-2' };

    expect(gatewayLifecycleProblem([open, move, close], 2)).toBe(
      'browser recorded 1 successful gateway open response but the journey requires at least 2',
    );
    expect(gatewayLifecycleProblem([open, open, move, close, close], 2)).toBeNull();
  });

  it('attributes each response to the HTTP method of its matching request', () => {
    expect(
      gatewayResponsesOf([
        event('Network.requestWillBeSent', {
          requestId: 'open',
          request: { method: 'POST', url: 'http://127.0.0.1/engine-api/sessions' },
        }),
        event('Network.responseReceived', {
          requestId: 'open',
          response: { status: 200, url: 'http://127.0.0.1/engine-api/sessions' },
        }),
        event('Network.requestWillBeSent', {
          requestId: 'close',
          request: {
            method: 'DELETE',
            url: 'http://127.0.0.1/engine-api/sessions/token-1',
          },
        }),
        event('Network.responseReceived', {
          requestId: 'close',
          response: { status: 200, url: 'http://127.0.0.1/engine-api/sessions/token-1' },
        }),
      ]),
    ).toEqual([
      {
        method: 'POST',
        status: 200,
        url: 'http://127.0.0.1/engine-api/sessions',
      },
      {
        method: 'DELETE',
        status: 200,
        url: 'http://127.0.0.1/engine-api/sessions/token-1',
      },
    ]);
  });

  it('ignores unrelated traffic and responses without a witnessed request', () => {
    expect(
      gatewayResponsesOf([
        event('Network.responseReceived', {
          requestId: 'unseen',
          response: { status: 200, url: 'http://127.0.0.1/engine-api/sessions' },
        }),
        event('Network.requestWillBeSent', {
          requestId: 'asset',
          request: { method: 'GET', url: 'http://127.0.0.1/assets/app.js' },
        }),
        event('Network.responseReceived', {
          requestId: 'asset',
          response: { status: 200, url: 'http://127.0.0.1/assets/app.js' },
        }),
      ]),
    ).toEqual([]);
  });
});
