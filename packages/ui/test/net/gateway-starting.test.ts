import { expect, it } from 'vitest';
import type { SessionError } from '@mtg/engine';
import {
  describeBackendOpenFailure,
  GATEWAY_STARTING_MESSAGE,
  GATEWAY_UNAVAILABLE_MESSAGE,
  isGatewayStarting,
} from '../../src/net/gateway-starting';

const starting: SessionError = {
  kind: 'backend-failure',
  message: 'gateway-starting: the backend gateway is still running its startup checks',
};

const unavailable: SessionError = {
  kind: 'backend-failure',
  message: 'gateway-unavailable: the configured engine gateway is not reachable',
};

it('shows the player-facing starting sentence while the gateway is coming up', () => {
  expect(isGatewayStarting(starting)).toBe(true);
  expect(describeBackendOpenFailure(starting)).toBe(GATEWAY_STARTING_MESSAGE);
});

it('says in plain words that the game server is not answering, and does not call that starting', () => {
  expect(isGatewayStarting(unavailable)).toBe(false);
  expect(describeBackendOpenFailure(unavailable)).toBe(GATEWAY_UNAVAILABLE_MESSAGE);
  expect(GATEWAY_UNAVAILABLE_MESSAGE).not.toMatch(/gateway|backend|engine/i);
});

it('falls through to the ordinary error description for every other backend failure', () => {
  const refused: SessionError = {
    kind: 'backend-failure',
    message: 'backend-refused: the table is full',
  };
  expect(describeBackendOpenFailure(refused)).toBe('backend-failure: backend-refused: the table is full');
});

it('never mistakes an unrelated session error for a starting gateway', () => {
  const unrelated: SessionError = { kind: 'timeout', message: 'the backend did not answer', millis: 5000 };
  expect(isGatewayStarting(unrelated)).toBe(false);
  expect(describeBackendOpenFailure(unrelated)).toBe('timeout: the backend did not answer');
});
