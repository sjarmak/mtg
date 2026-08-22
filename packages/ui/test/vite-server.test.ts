/**
 * The dev server's two halves, which only work together.
 *
 * The lab is meant to be looked at over a tunnel. That takes two settings in
 * `vite.config.ts` and neither does anything useful alone: `host` decides which
 * interfaces the listener binds, and `allowedHosts` decides which Host headers
 * it will answer for. `allowedHosts` alone is a door policy on a door nobody
 * outside loopback can walk up to, which is what this config carried from the
 * day the tunnel was first wanted until 2026-08-12. `host` alone puts the lab
 * on every network the machine sits on with no name check at all.
 *
 * So the pairing is the thing worth pinning, not either value. These read the
 * config as text rather than importing it: `vite.config.ts` imports `vite` and
 * `@vitejs/plugin-react` at module scope, and a unit test that pulls a bundler
 * in to read two fields has bought a slow test and a new failure mode for
 * nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONFIG_PATH = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const CONFIG = readFileSync(CONFIG_PATH, 'utf8');

/**
 * The whole `server: { ... }` object, which is where all of these settings live.
 *
 * Brace-matched rather than read as one line. It was one line until the netplay
 * proxy arrived and needed a nested object, and a line-based reader turns that
 * into three failures that say `host: true` is missing when it is four lines
 * below — which is a test lying about the thing it exists to protect.
 */
function serverBlock(): string {
  const start = CONFIG.indexOf('server:');
  expect(start, 'vite.config.ts has no `server:` key').toBeGreaterThan(-1);
  let depth = 0;
  for (let at = start; at < CONFIG.length; at += 1) {
    const char = CONFIG[at];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return CONFIG.slice(start, at + 1);
    }
  }
  throw new Error('vite.config.ts has an unbalanced `server:` block');
}

describe("the dev server's reachability over a tunnel", () => {
  it('binds every interface, so a request off the tunnel reaches the listener', () => {
    expect(
      serverBlock(),
      'Vite binds loopback by default. Without `host`, a Tailscale request never reaches the ' +
        'server whatever its Host header says, and `allowedHosts` below is answering for a door ' +
        'nobody can knock on.',
    ).toMatch(/host:\s*true/);
  });

  it('answers only for a tailnet name, which is what keeps the wide bind narrow', () => {
    expect(
      serverBlock(),
      'Binding every interface without a Host allow-list serves the lab to any network this ' +
        'machine is on. The `.ts.net` entry is the whole of what narrows it back.',
    ).toMatch(/allowedHosts:\s*\['\.ts\.net'\]/);
  });

  it('states the port the launcher and the docs both name', () => {
    // `npm run play` spawns `npx vite` with no port flag, so this number is the
    // only place the port is decided, and CLAUDE.md quotes it to a reader.
    expect(serverBlock()).toMatch(/port:\s*5273/);
  });

  it('sends the game server traffic to loopback and nowhere else', () => {
    // The netplay arrangement in one assertion (`@mtg/netplay`, `tools/netplay.ts`):
    // this process is the only listener another machine can reach, and what it
    // forwards `/api` to is on this machine. A target that named an interface
    // would put the game server on the network beside the page and undo the seat
    // capability, which is the whole of that lane's security story.
    const block = serverBlock();
    expect(block).toMatch(/'\/api'/);
    expect(block).toMatch(/http:\/\/127\.0\.0\.1:/);
  });

  it('sends the curation writes to loopback too, and to their own port', () => {
    // The curation grid is driven from a tablet over the same tunnel, and its
    // server is a second loopback process, the one `npm run curate` starts.
    // A target on an interface would put a write endpoint on the network; a
    // target on the netplay port would send picks to the game server.
    const block = serverBlock();
    expect(block).toMatch(/'\/curation-api'/);
    expect(block).toMatch(/http:\/\/127\.0\.0\.1:\$\{[^}]*MTG_CURATION_PORT/);
  });

  /**
   * The page's own port and the ports it proxies to are neighbors, and Vite's
   * default behavior on a busy port is to walk upward until something binds.
   * From 5273 that walk reaches the netplay server at 5274 and the curation
   * writer at 5275, so the page can end up listening on a service's port while
   * the proxy targets in this same file point back at the page.
   *
   * That is not hypothetical: `npm run curate` failed with `EADDRINUSE
   * 127.0.0.1:5275` because a Vite left over from an earlier run had walked up
   * onto the curation writer's port. Refusing to start names the port and costs
   * one line; wandering produces a page whose writes loop back to itself.
   *
   * Both halves are asserted, because either alone permits the collision: the
   * walk has to be off, and the three ports have to be distinct to begin with.
   */
  it('refuses to wander onto a neighboring service port', () => {
    const block = serverBlock();
    expect(block).toMatch(/strictPort:\s*true/);

    const own = /port:\s*(\d+)/.exec(block)?.[1];
    const targets = [...block.matchAll(/127\.0\.0\.1:\$\{[^}]*\?\?\s*'(\d+)'/g)].map((match) => match[1]);
    expect(own).toBeDefined();
    expect(targets.length).toBeGreaterThan(1);
    const ports = [own, ...targets];
    expect(new Set(ports).size, `${ports.join(', ')} are not all distinct`).toBe(ports.length);
  });

  it('explains why the two settings travel together, where the next reader will be', () => {
    // A pairing that only a test knows about is a pairing the next person
    // splits. The reason belongs above the line it governs.
    const comment = CONFIG.slice(0, CONFIG.indexOf('server:'));
    expect(comment).toMatch(/loopback/);
    expect(comment).toMatch(/allowedHosts/);
  });
});
