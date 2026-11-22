/**
 * Stagehand's client config defaults `telemetry.traces.endpoint` to
 * `https://example.com/v1/traces` with no off switch (`StagehandClientCreateConfigSchema`,
 * read directly off the shipped `dist/index.d.mts`, `docs/research/stagehand-jev-seam.md`).
 * The armed Stagehand path (`--max-usd`, `mtg-onjme.1`) must never let that
 * default reach a real host, so every `Stagehand.create()` call there passes
 * an explicit loopback endpoint built here instead.
 */

export const STAGEHAND_TELEMETRY_HOST = '127.0.0.1';

/**
 * Nothing has to listen on this port for the option to do its job: the
 * requirement is that traces never leave the loopback interface, not that
 * they land somewhere. An OTLP exporter with nothing to connect to fails its
 * own export silently (it is telemetry, not the journey) rather than failing
 * the run.
 */
export function loopbackTelemetryEndpoint(port = 4318): URL {
  return new URL(`http://${STAGEHAND_TELEMETRY_HOST}:${String(port)}/v1/traces`);
}
