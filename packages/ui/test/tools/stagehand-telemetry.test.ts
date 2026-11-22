/**
 * Stagehand's client config defaults `telemetry.traces.endpoint` to
 * `https://example.com/v1/traces` with no off switch. The armed path must
 * pass an explicit loopback endpoint instead, and this is the assertion that
 * the option handed to Stagehand names 127.0.0.1.
 */
import { describe, expect, it } from 'vitest';
import { loopbackTelemetryEndpoint, STAGEHAND_TELEMETRY_HOST } from '../../tools/stagehand-telemetry';

describe('loopbackTelemetryEndpoint', () => {
  it('names 127.0.0.1 as the telemetry host', () => {
    expect(STAGEHAND_TELEMETRY_HOST).toBe('127.0.0.1');
  });

  it('builds a loopback URL, never example.com or any other host', () => {
    const url = loopbackTelemetryEndpoint();
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.toString()).not.toContain('example.com');
  });

  it('uses the /v1/traces path Stagehand expects, at a stated port', () => {
    const url = loopbackTelemetryEndpoint(4318);
    expect(url.toString()).toBe('http://127.0.0.1:4318/v1/traces');
  });

  it('accepts a different port and still names the loopback host', () => {
    const url = loopbackTelemetryEndpoint(9999);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('9999');
  });
});
