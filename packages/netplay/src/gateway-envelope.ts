import type { ServerResponse } from 'node:http';
import type { SessionError } from '@mtg/engine';
import { json } from './http-support';

export const BACKEND_GATEWAY_PROTOCOL = 4;

export type BackendGatewayErrorCode =
  | 'malformed-request'
  | 'request-too-large'
  | 'unknown-session'
  | 'unknown-move'
  | 'stale-revision'
  | 'session-busy'
  | 'session-limit'
  | 'route-refused'
  | 'backend-refused'
  | 'wrong-method'
  | 'not-found'
  | 'server-closing'
  | 'gateway-starting';

export function failure(
  response: ServerResponse,
  status: number,
  code: BackendGatewayErrorCode,
  message: string,
  sessionError?: SessionError,
): void {
  json(response, status, {
    protocol: BACKEND_GATEWAY_PROTOCOL,
    ok: false,
    error: { code, message, ...(sessionError === undefined ? {} : { sessionError }) },
  });
}
