# Spike A — headless Forge sim throughput

Measured 2026-08-09 on the lab box. Every number below came from a run on this machine; nothing is
estimated or carried over from another report. Raw logs and timing files were produced by
`spike-a.sh` / `spike-a-par.sh` (reproduced verbatim in §7).

**Verdict (detail in §6): Forge is a viable mass-sim fallback substrate at 10³ games per set
revision, marginal at 10⁴, and unusable as a parity oracle — because `sim` cannot be driven, and
because the runs measured here were not reproducible.** 8-way parallel measured **10,936
games/hour**; 10³ games = 5.5 min, 10⁴ games = 73 min. Two identical 100-game commands disagreed on
**48 of 100 game winners**. Those commands passed no seed, and §5 is precise about what that does
and does not settle.

---

## 1. Environment

| Fact | Value |
|---|---|
| Forge | 2.0.14 ("The Hobbit Release"), `forge-installer-2.0.14.tar.bz2`, downloaded from the GitHub release 2026-08-09 |
| Entry point | `forge-gui-desktop-2.0.14-jar-with-dependencies.jar`, `sim` mode |
| JVM | OpenJDK 21.0.11 (Ubuntu), JRE only — no JDK on this box |
| Host | Linux 7.0.0-28-generic, 16 logical CPUs, 15,968 MB RAM (Forge's own `GuiBase` banner) |
| Decks | two shipped precons, `res/quest/precons/Abzan Siege.dck` (KTK) and `Air Forces.dck` |
| Card DB loaded per run | 33,617 archived scripts + 836 loose files |

### 1.1 Forge does not actually run headless — it runs *display-less-ly* only under an X server

`java -jar forge-gui-desktop-…jar sim …` **exits 1 with zero output** on a machine with no
`DISPLAY`. Class-load tracing shows `forge.view.Main` constructs `forge.GuiDesktop` and registers
`forge.error.ExceptionHandler` *before* dispatching to `sim`, so the Swing construction throws, the
handler swallows the trace (it redirects console output to a log file), Sentry uploads a crash
report, and the process dies silently. Nothing about the failure names the cause.

The fix is an X server; Xvfb is enough:

```bash
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
DISPLAY=:99 java -jar forge-gui-desktop-2.0.14-jar-with-dependencies.jar sim -d a.dck b.dck -n 1 -q
```

This box had no `Xvfb` package and no root; `apt-get download xvfb && dpkg -x xvfb_*.deb root/` and
running `./root/usr/bin/Xvfb` worked with no further dependencies. **Any CI job that runs Forge
must provision an X server**, and `@mtg/forge-export`'s boot gate reports the silent-exit signature
as `skipped` with that reason rather than failing the cards for it.

The full Swing GUI also comes up under Xvfb (it wrote `preferences/`, `quest/`, `gauntlet/` and
loaded the custom set), which is the evidence for the design brief's "Forge as an early human play
surface" graft.

---

## 2. Single-process throughput

| Run | Games | Wall clock | Games/s | Games/hour |
|---|---|---|---|---|
| `-n 1 -q` (start-up probe) | 1 | 3.86 s | — | — |
| `-n 100 -q` | 100 | 98.31 s | 1.017 | **3,662** |
| `-n 100` (full log) | 100 | 154.39 s | 0.648 | 2,332 |
| `-n 100 -q`, repeat | 100 | 124.35 s | 0.804 | 2,895 |

Reading of these:

- **Fixed start-up is ~3.9 s** (JVM + 33,617-script card database + one 1.7 s game), amortized
  across the run: at `-n 100` it is 4% of wall clock, at `-n 1` it is 70%. Batch, never per-game.
- **Steady-state is ~1.06 games/s** for this matchup (94.4 s of games after subtracting start-up).
  Individual games ranged from 0.58 s to 1.8 s; both decks are aggro-ish creature decks, which the
  Forge AI wiki calls its strong case. Control or combo matchups should be assumed slower, and the
  120 s/game default clock (`-c`) bounds the worst case.
- **The repeat run's 124.35 s is the same command as the 98.31 s run**, taken while other work was
  on the box. Treat single-process throughput as 2.9k–3.7k games/hour depending on load, not as a
  crisp 3.7k.

---

## 3. Parallel throughput

Independent JVMs, same deck pair, `-Xmx2048m` each:

| Workers | Games/worker | Total games | Wall clock | Games/s | Games/hour |
|---|---|---|---|---|---|
| 8 | 50 | 400 | 131.66 s | 3.04 | **10,936** |
| 16 | 50 | 800 | 289.79 s | 2.76 | 9,938 |

- 8 workers on 16 logical cores gives **~3× a single process**, not 8×. Each JVM also pays its own
  3.9 s start-up and its own copy of the card database.
- **16 workers is slower than 8.** 16 × 2 GB heap over-commits a 16 GB box; this is a memory wall,
  not a CPU wall. Worker count should be sized by RAM ÷ heap, not by core count.
- Practical ceiling on this hardware: **~11k games/hour**, i.e. 10³ games in 5.5 min and 10⁴ games
  in 73 min.

---

## 4. Log-parse cost

Two separate costs, and only one of them matters.

| | Quiet (`-q`) | Full log |
|---|---|---|
| Output for 100 games | 36,426 B (0.36 KB/game) | 2,275,335 B (22.8 KB/game) |
| Forge's own wall-clock cost | baseline | **+57%** (98.3 s → 154.4 s) |
| Our parse (`parseSimOutput`, 100 games) | 0.16 ms | 6.65 ms |

- Parsing on our side is **free**: 6.65 ms to parse 2.3 MB is four orders of magnitude below the
  154 s Forge spent producing it.
- **Emitting the log is the expensive half.** Turning on full logs costs 57% of throughput —
  roughly 4k games/hour of the 11k budget. Anything the metrics lane wants per-game must justify
  itself against that, and `-q` output is thin: game number, duration, winner clause, match score.
  There is no structured per-action stream to harvest; the 17lands-superset replay schema cannot be
  populated from `-q` output at all, and would need the full log parsed into per-action events.

---

## 5. Seed reproducibility — the runs measured here are not reproducible, and none of them used `-s`

**The CLI does have a seed flag; the distribution's documentation does not mention it.** `docs/AI.md`
lists the switches as `-d -D -n -m -f -t -p -q -c` and stops, which is what an earlier reading of
this section took for the whole surface. The binary disagrees. `argumentHelp` in
`forge/view/SimulateMatch.class`, read out of the shipped
`forge-gui-desktop-2.0.14-jar-with-dependencies.jar`, ends its syntax line with two more switches
and documents them:

```
Syntax: forge.exe sim -d <deck1[.dck]> ... <deckX[.dck]> -D [D] -n [N] -m [M] -t [T] -p [P] -f [F] -s [S] -a [A] -q
    S - RNG seed for simulation
    A - AI profile per player, in the same order as the decks (e.g. -a Default Experimental)
```

The same class parses `-s` with `Long.parseLong` and hands `new Random(seed)` to
`forge.util.MyRandom.setRandom`, and validates `-a` against `AiProfileUtil.getProfilesDisplayList()`.
Both are real, and both were invisible from the documentation this spike worked from.

Empirically, two runs of the byte-identical command
`sim -d precon-a.dck precon-b.dck -n 100 -q` — **no `-s`, in either run**:

- **48 of 100 games ended with a different winner**, starting at game 3.
- Match score 68–32 in the first run, 64–36 in the second.
- The single-game probe likewise won for Abzan Siege in one run and Air Forces in the next.

So an *unseeded* `sim` is a sample from a distribution, not a reproducible trace. That is the whole
of what was measured, and it is worth being exact about the gap: **whether `-s` yields a
reproducible trace is untested here.** The test is cheap and specific — run §7's determinism probe
twice with `-s 1` added and diff the winner lines — and it is the one thing that would move two of
the three consequences below. Nobody has run it.

Consequences, in decreasing order of how much they hurt:

1. **The parity-harness plan does not work through this CLI, and a seed would not rescue it.**
   Manabrew's method ("same decks, same seed, deterministic choices, diff the first divergent
   field", engines §2) needs a *driven* engine. `sim` takes two decks and prints a result; there is
   no way to hand it our kernel's choices or to read a state snapshot back out, so a seed buys a
   Forge game we can rerun, not a Forge game we can compare against ours field by field. A parity
   oracle needs the purpose-built Java bridge (engines §1.4 path 2) or the GraalVM harness (path 3).
   Those two are not in the same position, and an earlier version of this line wrongly put them
   there. **Path 3 is out of bounds**: it compiles a Forge harness into a native shared library
   linked in-process, and ADR-0001 §5.1 names that recipe specifically as what the arm's-length rule
   excludes. **Path 2 is not out of bounds**: it is a JVM subprocess speaking JSON over stdio
   against the GUI-free `forge-game`, which is a process boundary, and ADR-0001 §6.2 adopts exactly
   it as the Forge-bridge fallback — "a GPL module isolated behind the process boundary", with every
   condition in §5 continuing to apply. The constraint that actually bites for path 2 is §5.4's CI
   license-header guard, which fails the build on a GPL header anywhere in our own tree: the bridge
   is our Java linked against GPL `forge-game`, so where that source lives and under what header is
   a decision to settle before it is written. Neither path is on the phase-1 plan.
2. **Balance CI cannot pin a Forge number from an unseeded run.** Any metric taken the way the runs
   above were taken is a noisy estimate; a regression assertion against it needs a confidence
   interval, not an equality. If `-s` reproduces, this one is recoverable and becomes a question of
   whether we want a Forge-derived number at all.
3. **Bisecting a Forge divergence waits on the same probe.** "Run it again with the same seed" is
   the whole technique, and whether it works here is precisely what has not been tested.

Deferred question 2 in `decision-synthesis.md` ("whether the `sim` CLI can be seeded reproducibly")
is **still open**, and this spike narrows rather than closes it: the flag exists, the runs measured
here did not use it, and the probe that would settle it is two commands. ADR-0001 §8 item 2 and
`decision-synthesis.md` §7 item 2 both still carry it as unverified, which is the correct state.

---

## 6. Verdict: can Forge serve as a mass-sim fallback substrate at 10³–10⁴ games per set revision?

**Yes at 10³, marginally at 10⁴, and only as a sampler — never as an oracle.**

| Workload | Forge cost on this box | Judgment |
|---|---|---|
| 10³ games / revision | 5.5 min (8-way) | Comfortable |
| 10⁴ games / revision | 73 min (8-way) | Tolerable overnight, too slow for an inner loop |
| 10⁴ games with full logs | ~115 min | Uncomfortable |
| Per-mechanic parity diffing | impossible | Blocked by §5 |

What this does and does not do to the engine bet:

- It **does** keep the pre-committed fallback in `decision-synthesis.md` §4.2 alive: if kernel
  velocity stalls at the layers/replacement cliff, Forge can carry mass playtesting of exported
  sets at brief-relevant volumes. The fallback is real, and now sized.
- It **does not** rescue the oracle half of the graft. Forge remains a *boot-and-play conformance
  gate* (which spike B shows works, and which `@mtg/forge-export`'s `bootGate` now implements) and
  a human play surface. It is not a second opinion on a specific game, because there is no specific
  game to agree about.
- The 3.9 s per-process start-up and the memory wall mean any orchestration must be **batched and
  RAM-sized**: one JVM per ~2 GB, hundreds of games per JVM, never a JVM per game.

The threshold question deferred in `decision-synthesis.md` §7.3 now has one side of its comparison:
whatever games/sec the TS kernel achieves, the number to beat for "Forge would have been good
enough" is **~3 games/s across the box**, and a kernel that cannot beat a JVM-per-2 GB Java engine
by a wide margin is not buying us much beyond determinism.

Determinism is still the thing worth buying, but this spike no longer gets to claim it as the
kernel's alone. That sentence was written when §5 said `sim` could not be seeded at all; §5 now says
the `-s` flag exists, parses, and reaches `MyRandom`, and that nobody has run the probe that would
say whether it produces a reproducible trace. What survives unchanged is the parity argument, which
never depended on the seed: `sim` prints a result rather than exposing a driven game, so it cannot
be diffed field by field however well it is seeded.

---

## 7. Exact commands

```bash
# 0. one-time: Forge distribution (GPL-3.0, gitignored, never vendored)
curl -L -o tools/forge/forge-installer-2.0.14.tar.bz2 \
  https://github.com/Card-Forge/forge/releases/download/forge-2.0.14/forge-installer-2.0.14.tar.bz2
mkdir -p tools/forge/dist && tar -xjf tools/forge/forge-installer-2.0.14.tar.bz2 -C tools/forge/dist

# 1. an X server (Forge needs one even in sim mode; see §1.1)
apt-get download xvfb && dpkg -x xvfb_*.deb xvfbroot
./xvfbroot/usr/bin/Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &

# 2. keep Forge's data inside the artifact directory
cd tools/forge/dist
printf 'userDir=%s\ncacheDir=%s\n' "$PWD/userdata" "$PWD/userdata/cache" > forge.profile.properties
mkdir -p userdata/decks/constructed
cp "res/quest/precons/Abzan Siege.dck" userdata/decks/constructed/precon-a.dck
cp "res/quest/precons/Air Forces.dck"  userdata/decks/constructed/precon-b.dck

# 3. the measurements
JAR=forge-gui-desktop-2.0.14-jar-with-dependencies.jar
time DISPLAY=:99 java -Xmx4096m -Dfile.encoding=UTF-8 -jar $JAR sim -d precon-a.dck precon-b.dck -n 1   -q
time DISPLAY=:99 java -Xmx4096m -Dfile.encoding=UTF-8 -jar $JAR sim -d precon-a.dck precon-b.dck -n 100 -q
time DISPLAY=:99 java -Xmx4096m -Dfile.encoding=UTF-8 -jar $JAR sim -d precon-a.dck precon-b.dck -n 100

# 4. parallel: N workers, 50 games each, 2 GB heap apiece
for w in $(seq 1 8); do
  DISPLAY=:99 java -Xmx2048m -jar $JAR sim -d precon-a.dck precon-b.dck -n 50 -q > par8-w$w.log 2>&1 &
done; time wait

# 5. determinism: run 3 twice, then
diff <(grep '^Game Result' run1.log | sed 's/ended in [0-9]* ms\.//') \
     <(grep '^Game Result' run2.log | sed 's/ended in [0-9]* ms\.//')
```

Sample of the output the numbers were read from:

```
Read cards: 33617 archived files in 0 ms (25 parts) using thread pool
Simulation mode
Ai(1)-Abzan Siege vs Ai(2)-Air Forces - one game of Constructed
Game Outcome: Turn 9
Game Outcome: Ai(2)-Air Forces has won because all opponents have lost
Match Result: Ai(1)-Abzan Siege: 0 Ai(2)-Air Forces: 1
Game Result: Game 1 ended in 1700 ms. Ai(2)-Air Forces has won!
```

Parsing of that format lives in `packages/forge-export/src/sim-output.ts` and is unit-tested
against this verbatim transcript.
