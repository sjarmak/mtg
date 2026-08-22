# tools/forge

Forge lives here as a **downloaded artifact**, never as source.

Forge is GPL-3.0. This lab drives it as a subprocess and nothing else: no vendored source, no
linking, no copied card scripts. `tools/forge/dist/`, `*.tar.bz2` and `*.jar` are gitignored, so
nothing under this directory except this file is ever committed.

## Install

```bash
cd tools/forge
curl -L -o forge-installer-2.0.14.tar.bz2 \
  https://github.com/Card-Forge/forge/releases/download/forge-2.0.14/forge-installer-2.0.14.tar.bz2
mkdir -p dist && tar -xjf forge-installer-2.0.14.tar.bz2 -C dist
```

Requires Java 21 (a JRE is enough). `@mtg/forge-export` finds the distribution at
`tools/forge/dist` by default; `FORGE_HOME` overrides it.

## An X server is required

Forge's desktop entry point constructs its Swing GUI before it dispatches to `sim`, so with no
`DISPLAY` it **exits 1 printing nothing at all**. Xvfb is enough:

```bash
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
export DISPLAY=:99
```

`bootGate` recognizes the silent-exit signature and reports `skipped` with this reason rather than
blaming the cards.

## Lab data directory

`@mtg/forge-export` writes `dist/forge.profile.properties` pointing Forge's `userDir` at
`dist/userdata`, so exported sets, decks and logs stay inside the gitignored artifact directory and
never touch a developer's own `~/.forge` profile.

## Usage

```bash
DISPLAY=:99 npx tsx packages/forge-export/src/cli.ts boot-gate            # transpile, boot, play
DISPLAY=:99 npx tsx packages/forge-export/src/cli.ts export /tmp/set-out  # write files only
```

Measurements and findings: `docs/research/spike-a-forge-throughput.md`,
`docs/research/spike-b-forge-custom-sets.md`.
