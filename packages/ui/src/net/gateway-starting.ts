import type { SessionError } from '@mtg/engine';
import { describeSessionError } from '@mtg/engine';

export const GATEWAY_STARTING_MESSAGE = 'The game server is starting and will be ready in a few minutes.';

export const GATEWAY_UNAVAILABLE_MESSAGE =
  'The game server is not answering right now. Try again in a minute.';

export const GATEWAY_STARTING_RETRY_MS = 5000;

function gatewayFailure(error: SessionError, code: string): boolean {
  return error.kind === 'backend-failure' && error.message.startsWith(`${code}:`);
}

export function isGatewayStarting(error: SessionError): boolean {
  return gatewayFailure(error, 'gateway-starting');
}

export function describeBackendOpenFailure(error: SessionError): string {
  if (isGatewayStarting(error)) return GATEWAY_STARTING_MESSAGE;
  if (gatewayFailure(error, 'gateway-unavailable')) return GATEWAY_UNAVAILABLE_MESSAGE;
  return describeSessionError(error);
}
